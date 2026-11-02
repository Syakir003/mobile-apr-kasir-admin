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
  private baseWhere(q?: string, memberId?: string): Prisma.MemberAcUnitWhereInput {
    const term = q?.trim();
    return {
      status: { not: 'menunggu_pemasangan' },
      member: { active: true },
      ...(memberId ? { memberId } : {}),
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
    const base = this.baseWhere(query.q, query.memberId);

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
        // Status unit (member_ac_units.status), terpisah dari `status` klasifikasi jadwal di bawah.
        // Dipakai UI untuk menandai unit yang sedang diservis ('dalam_maintenance'): cron pengingat
        // hanya memproses unit 'aktif'.
        unitStatus: u.status,
        status: classifySchedule(u, now),
        adaJobBerjalan: busy.has(u.id),
        lastWa: lastLog
          ? { kind: lastLog.kind, status: lastLog.status, error: lastLog.error, at: lastLog.createdAt }
          : null,
      };
    });

    return { counts, items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * Monitoring per PELANGGAN: 1 baris = 1 member + ringkasan semua set AC-nya, supaya member dengan banyak AC
   * tidak berserakan di tabel. Daftar AC lengkap tiap member diambil lewat schedule({ memberId }).
   *
   * Pencarian & filter status hanya MEMILIH member (yang punya minimal 1 AC cocok); ringkasan tiap member
   * selalu memuat SEMUA set AC-nya. Urutan: jadwal servis terdekat dulu, member tanpa jadwal di akhir.
   * `counts` (untuk kartu ringkasan) tetap hitungan per set AC.
   */
  async scheduleByMember(query: ScheduleQueryDto) {
    const now = new Date();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const base = this.baseWhere(query.q);
    const where: Prisma.MemberAcUnitWhereInput = query.status
      ? { AND: [base, scheduleStatusWhere(query.status, now)] }
      : base;

    const [countsArr, total, groups] = await Promise.all([
      Promise.all(
        SCHEDULE_STATUSES.map((st) =>
          this.prisma.memberAcUnit.count({ where: { AND: [base, scheduleStatusWhere(st, now)] } }),
        ),
      ),
      this.prisma.member.count({ where: { acUnits: { some: where } } }),
      this.prisma.memberAcUnit.groupBy({
        by: ['memberId'],
        where,
        // Jadwal terdekat dulu (NULL = tanpa jadwal, otomatis terakhir di Postgres), lalu id supaya urutan stabil.
        orderBy: [{ _min: { nextServiceDate: 'asc' } }, { memberId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const counts = Object.fromEntries(SCHEDULE_STATUSES.map((st, i) => [st, countsArr[i]])) as Record<
      ScheduleStatus,
      number
    >;

    const memberIds = groups.map((g) => g.memberId);
    const units = memberIds.length
      ? await this.prisma.memberAcUnit.findMany({
          // Tanpa pencarian: ringkasan member memuat semua AC-nya, bukan hanya yang cocok dengan kata kunci.
          where: { AND: [this.baseWhere(), { memberId: { in: memberIds } }] },
          include: UNIT_INCLUDE,
        })
      : [];

    const unitIds = units.map((u) => u.id);
    const [logs, openJobs] = unitIds.length
      ? await Promise.all([
          // Terbaru per member (distinct mengambil baris pertama sesuai orderBy).
          this.prisma.whatsappLog.findMany({
            where: { kind: { in: [...REMINDER_LOG_KINDS] }, memberId: { in: memberIds } },
            orderBy: { createdAt: 'desc' },
            distinct: ['memberId'],
            select: { memberId: true, kind: true, status: true, error: true, createdAt: true },
          }),
          this.prisma.technicianJob.findMany({
            where: { unitId: { in: unitIds }, status: { notIn: ['selesai', 'dibatalkan'] } },
            select: { unitId: true },
          }),
        ])
      : [[], []];
    const busy = new Set(openJobs.map((j) => j.unitId));
    const lastLogByMember = new Map(logs.map((l) => [l.memberId, l]));

    const unitsByMember = new Map<string, typeof units>();
    for (const u of units) {
      const list = unitsByMember.get(u.memberId);
      if (list) list.push(u);
      else unitsByMember.set(u.memberId, [u]);
    }

    const items = memberIds.flatMap((memberId) => {
      const list = unitsByMember.get(memberId);
      if (!list?.length) return [];

      const memberCounts = Object.fromEntries(SCHEDULE_STATUSES.map((st) => [st, 0])) as Record<
        ScheduleStatus,
        number
      >;
      let nextService: { date: Date; status: ScheduleStatus } | null = null;
      let jobBerjalanCount = 0;
      let bukanAktifCount = 0;
      for (const u of list) {
        const st = classifySchedule(u, now);
        memberCounts[st] += 1;
        if (
          u.reminderEnabled &&
          u.nextServiceDate &&
          st !== 'menunggu_data' &&
          (!nextService || u.nextServiceDate < nextService.date)
        ) {
          nextService = { date: u.nextServiceDate, status: st };
        }
        const isBusy = busy.has(u.id);
        if (isBusy) jobBerjalanCount += 1;
        // 'dalam_maintenance' tanpa job berjalan = tersangkut; cron pengingat hanya memproses unit 'aktif'.
        if (u.status === 'dalam_maintenance' && !isBusy) bukanAktifCount += 1;
      }

      const member = list[0].member;
      const lastLog = lastLogByMember.get(memberId);
      return [
        {
          memberId,
          name: member.name,
          phone: member.phone,
          waOptOut: member.waOptOut,
          unitCount: list.length,
          counts: memberCounts,
          nextService,
          jobBerjalanCount,
          bukanAktifCount,
          lastWa: lastLog
            ? { kind: lastLog.kind, status: lastLog.status, error: lastLog.error, at: lastLog.createdAt }
            : null,
        },
      ];
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
