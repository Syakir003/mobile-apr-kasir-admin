import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WhatsappLogStatus, WhatsappMessageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { waPhone } from '../whatsapp/wa-format.util';
import { wibDateOnly } from '../common/wib-date.util';
import { RemindersService } from './reminders.service';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import {
  SCHEDULE_STATUSES,
  ScheduleStatus,
  classifySchedule,
  manualReminderKind,
  scheduleStatusWhere,
} from './service-schedule.util';

const REMINDER_LOG_KINDS = ['selesai_servis', 'reminder_h3', 'reminder_h7'] as const;
const MANUAL_COOLDOWN_MS = 24 * 3600 * 1000;

const UNIT_INCLUDE = {
  member: { select: { id: true, name: true, phone: true, waOptOut: true, active: true } },
  indoorProduct: { select: { name: true } },
  outdoorProduct: { select: { name: true } },
} satisfies Prisma.MemberAcUnitInclude;

/**
 * Monitoring jadwal servis + pengingat manual (2026-09-30). "Unit AC" =
 * 1 set AC (indoor+outdoor) = 1 baris member_ac_units = 1 pengingat.
 */
@Injectable()
export class ServiceScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly reminders: RemindersService,
  ) {}

  /** Filter dasar: set AC yang relevan buat dimonitor. */
  private baseWhere(q?: string): Prisma.MemberAcUnitWhereInput {
    const term = q?.trim();
    return {
      status: { not: 'menunggu_pemasangan' },
      member: { active: true },
      ...(term
        ? {
            OR: [
              { member: { name: { contains: term, mode: 'insensitive' } } },
              { member: { phone: { contains: term } } },
              { roomLocation: { contains: term, mode: 'insensitive' } },
              { brand: { contains: term, mode: 'insensitive' } },
              { model: { contains: term, mode: 'insensitive' } },
              { indoorProduct: { name: { contains: term, mode: 'insensitive' } } },
              { outdoorProduct: { name: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  async schedule(query: ScheduleQueryDto) {
    const now = new Date();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const base = this.baseWhere(query.q);

    const where: Prisma.MemberAcUnitWhereInput = query.status
      ? { AND: [base, scheduleStatusWhere(query.status, now)] }
      : base;

    const [countsArr, total, rows] = await Promise.all([
      Promise.all(
        SCHEDULE_STATUSES.map((st) =>
          this.prisma.memberAcUnit.count({ where: { AND: [base, scheduleStatusWhere(st, now)] } }),
        ),
      ),
      this.prisma.memberAcUnit.count({ where }),
      this.prisma.memberAcUnit.findMany({
        where,
        include: UNIT_INCLUDE,
        orderBy: [{ nextServiceDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const counts = Object.fromEntries(SCHEDULE_STATUSES.map((st, i) => [st, countsArr[i]])) as Record<
      ScheduleStatus,
      number
    >;

    const ids = rows.map((r) => r.id);
    const [logs, openJobs] = ids.length
      ? await Promise.all([
          this.prisma.whatsappLog.findMany({
            where: { kind: { in: [...REMINDER_LOG_KINDS] }, unitIds: { hasSome: ids } },
            orderBy: { createdAt: 'desc' },
            take: 500,
            select: { unitIds: true, kind: true, status: true, error: true, createdAt: true },
          }),
          this.prisma.technicianJob.findMany({
            where: {
              unitId: { in: ids },
              status: { notIn: ['selesai', 'dibatalkan'] },
            },
            select: { unitId: true },
          }),
        ])
      : [[], []];
    const busy = new Set(openJobs.map((j) => j.unitId));

    const items = rows.map((u) => {
      const lastLog = logs.find((l) => l.unitIds.includes(u.id));
      const label =
        `${u.brand ?? ''} ${u.model ?? ''}`.replace(/\s+/g, ' ').trim() ||
        u.indoorProduct?.name ||
        u.outdoorProduct?.name ||
        'Unit AC';
      return {
        id: u.id,
        label,
        roomLocation: u.roomLocation,
        pk: u.pk,
        member: u.member,
        lastServiceDate: u.lastServiceDate,
        serviceIntervalDays: u.serviceIntervalDays,
        nextServiceDate: u.nextServiceDate,
        reminderEnabled: u.reminderEnabled,
        status: classifySchedule(u, now),
        adaJobBerjalan: busy.has(u.id),
        lastWa: lastLog
          ? { kind: lastLog.kind, status: lastLog.status, error: lastLog.error, at: lastLog.createdAt }
          : null,
      };
    });

    return { counts, items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** Kirim pengingat manual untuk 1 set AC (di luar cron H-3/H+7). */
  async sendNow(unitId: string, actorId: string) {
    const now = new Date();
    const unit = await this.prisma.memberAcUnit.findUnique({
      where: { id: unitId },
      include: UNIT_INCLUDE,
    });
    if (!unit) throw new NotFoundException('Unit AC tidak ditemukan');
    if (unit.status === 'menunggu_pemasangan') {
      throw new BadRequestException('AC ini belum dipasang, belum ada jadwal servis.');
    }
    if (unit.status === 'menunggu_data') {
      throw new BadRequestException('Data AC ini belum dilengkapi teknisi, belum ada jadwal servis.');
    }
    if (!unit.reminderEnabled) {
      throw new BadRequestException('Pengingat AC ini sedang dimatikan. Nyalakan dulu sebelum mengirim.');
    }
    if (!unit.nextServiceDate) {
      throw new BadRequestException('AC ini belum punya jadwal servis berikutnya. Isi siklus servisnya dulu.');
    }
    if (!unit.member.active) throw new BadRequestException('Pelanggan ini sudah nonaktif.');
    if (unit.member.waOptOut) {
      throw new BadRequestException('Pelanggan ini meminta tidak dikirimi pesan WhatsApp.');
    }
    const phone = waPhone(unit.member.phone);
    if (!phone) throw new BadRequestException('Pelanggan ini tidak punya nomor HP yang valid.');

    // Anti dobel: pengingat (pending/terkirim) untuk AC ini < 24 jam terakhir.
    const recent = await this.prisma.whatsappLog.findFirst({
      where: {
        kind: { in: [WhatsappMessageKind.reminder_h3, WhatsappMessageKind.reminder_h7] },
        unitIds: { has: unitId },
        status: { in: [WhatsappLogStatus.pending, WhatsappLogStatus.terkirim] },
        createdAt: { gte: new Date(now.getTime() - MANUAL_COOLDOWN_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      const when = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(recent.createdAt);
      throw new ConflictException(
        `Pengingat untuk AC ini sudah dikirim pada ${when} WIB. Tunggu 24 jam sebelum mengirim lagi.`,
      );
    }

    const kind = manualReminderKind(unit.nextServiceDate, now);
    const db = this.prisma as unknown as Prisma.TransactionClient;
    const message = await this.reminders.buildBodyTx(
      db,
      unit.memberId,
      kind,
      [unitId],
      wibDateOnly(unit.nextServiceDate),
    );
    const log = await this.whatsapp.createPendingTx(db, {
      memberId: unit.memberId,
      kind: kind === 'reminder_h3' ? WhatsappMessageKind.reminder_h3 : WhatsappMessageKind.reminder_h7,
      unitIds: [unitId],
      phone,
      message,
      dueDate: wibDateOnly(unit.nextServiceDate),
      sentById: actorId,
    });
    if (!log) throw new ConflictException('Pesan gagal dibuat, coba lagi.');

    const final = await this.whatsapp.sendPendingLog(log.id);
    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'reminder.send_now',
        target: unitId,
        detail: { kind, status: final.status },
      },
    });
    return { status: final.status, error: final.error, kind, phone, sentAt: final.sentAt };
  }
}
