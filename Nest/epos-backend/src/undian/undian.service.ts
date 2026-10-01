import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma, WhatsappMessageKind } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { formatTanggalId, waPhone } from '../whatsapp/wa-format.util';
import { wibDateOnly, wibDayRange } from '../common/wib-date.util';
import { randomVoucherCode } from '../vouchers/vouchers.service';
import { CreateUndianDto } from './dto/create-undian.dto';
import { UpdateParticipantsDto } from './dto/update-participants.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Port RPC create_undian / update_undian_participants / draw_undian /
 * cancel_undian (migrasi Supabase 0028) ke Prisma. Beda yang disengaja:
 * - Kriteria peserta dari `invoices` (bukan `transactions`): di native,
 *   transaksi manual/data lampau cuma jadi invoice. Invoice batal/refund
 *   gak dihitung. dateFrom ATAU dateTo diisi = wajib punya invoice di rentang.
 * - WA pemenang lewat WhatsappService (Fonnte, whatsapp_logs) — ikut web —
 *   bukan wa_outbox.
 */
@Injectable()
export class UndianService {
  private readonly logger = new Logger(UndianService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async findAll() {
    const rows = await this.prisma.undian.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { participants: true } } },
    });
    return rows.map(({ _count, ...u }) => ({ ...u, participantCount: _count.participants }));
  }

  async findOne(id: string) {
    const undian = await this.prisma.undian.findUnique({
      where: { id },
      include: {
        participants: {
          orderBy: { addedAt: 'asc' },
          include: { member: { select: { id: true, name: true, phone: true } } },
        },
        vouchers: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            code: true,
            status: true,
            expiresAt: true,
            member: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!undian) throw new NotFoundException('Undian tidak ditemukan');
    const { vouchers, ...rest } = undian;
    return { ...rest, participantCount: rest.participants.length, winners: vouchers };
  }

  async create(dto: CreateUndianDto, actorId: string) {
    if (dto.discountType === 'persen' && dto.discountValue > 100) {
      throw new BadRequestException('Diskon persen maksimal 100');
    }
    const criteria = dto.criteria ?? {};
    const invoiceWhere: Prisma.InvoiceWhereInput = {
      status: { notIn: [InvoiceStatus.batal, InvoiceStatus.refund] },
      createdAt: {
        ...(criteria.dateFrom ? { gte: wibDayRange(new Date(`${criteria.dateFrom}T12:00:00+07:00`)).start } : {}),
        ...(criteria.dateTo ? { lte: wibDayRange(new Date(`${criteria.dateTo}T12:00:00+07:00`)).end } : {}),
      },
      ...(criteria.mustHaveAcPurchase ? { items: { some: { kind: 'product' } } } : {}),
    };
    const needInvoice = !!(criteria.dateFrom || criteria.dateTo || criteria.mustHaveAcPurchase);

    const candidates = await this.prisma.member.findMany({
      where: { active: true, ...(needInvoice ? { invoices: { some: invoiceWhere } } : {}) },
      select: { id: true, phone: true },
    });
    // Sama kayak RPC: cuma member yang punya nomor WA valid (pemenang dikabari lewat WA).
    const memberIds = candidates.filter((m) => waPhone(m.phone) !== '').map((m) => m.id);

    return this.prisma.$transaction(async (tx) => {
      const undian = await tx.undian.create({
        data: {
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          criteria: { ...criteria },
          winnerCount: dto.winnerCount,
          discountType: dto.discountType,
          discountValue: Math.round(dto.discountValue),
          maxDiscountCap: dto.maxDiscountCap == null ? null : Math.round(dto.maxDiscountCap),
          minPurchase: dto.minPurchase == null ? null : Math.round(dto.minPurchase),
          voucherValidDays: dto.voucherValidDays,
          createdById: actorId,
        },
      });
      await tx.undianParticipant.createMany({
        data: memberIds.map((memberId) => ({ undianId: undian.id, memberId, source: 'otomatis' })),
        skipDuplicates: true,
      });
      const participantCount = await tx.undianParticipant.count({ where: { undianId: undian.id } });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'undian.create',
          target: undian.id,
          detail: { title: undian.title, participantCount },
        },
      });
      return { ok: true, undianId: undian.id, participantCount };
    });
  }

  async updateParticipants(undianId: string, dto: UpdateParticipantsDto, actorId: string) {
    const add = dto.add ?? [];
    const remove = dto.remove ?? [];
    return this.prisma.$transaction(async (tx) => {
      await this.lockBerjalan(tx, undianId, 'peserta tidak bisa diubah lagi');

      // Peserta manual juga wajib aktif & punya nomor WA valid (RPC asli cuma
      // ngecek aktif): pemenang tanpa HP gak bisa dikabari & vouchernya gak
      // kepakai di POS (checkout wajib HP). Yang gak memenuhi dilewati.
      let skipped = 0;
      if (add.length) {
        const members = await tx.member.findMany({
          where: { id: { in: add }, active: true },
          select: { id: true, phone: true },
        });
        const valid = members.filter((m) => waPhone(m.phone) !== '');
        skipped = add.length - valid.length;
        await tx.undianParticipant.createMany({
          data: valid.map((m) => ({ undianId, memberId: m.id, source: 'manual' })),
          skipDuplicates: true,
        });
      }
      if (remove.length) {
        await tx.undianParticipant.deleteMany({ where: { undianId, memberId: { in: remove } } });
      }
      const participantCount = await tx.undianParticipant.count({ where: { undianId } });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'undian.update_participants',
          target: undianId,
          detail: { added: add.length - skipped, skipped, removed: remove.length },
        },
      });
      return { ok: true, participantCount, skipped };
    });
  }

  async draw(undianId: string, actorId: string) {
    const { result, logIds } = await this.prisma.$transaction(async (tx) => {
      const undian = await this.lockBerjalan(tx, undianId, 'tidak bisa ditarik lagi');
      const participants = await tx.undianParticipant.findMany({
        where: { undianId },
        include: { member: { select: { id: true, name: true, phone: true } } },
      });
      if (participants.length < undian.winnerCount) {
        throw new BadRequestException(
          `Peserta (${participants.length}) kurang dari jumlah pemenang (${undian.winnerCount})`,
        );
      }

      // Fisher-Yates parsial pakai crypto.randomInt (acak yang adil).
      for (let i = 0; i < undian.winnerCount; i++) {
        const j = i + randomInt(participants.length - i);
        [participants[i], participants[j]] = [participants[j], participants[i]];
      }
      const winners = participants.slice(0, undian.winnerCount);

      // Berlaku sampai akhir hari WIB ke-(hari ini + voucherValidDays), sama kayak RPC.
      const expiresAt = new Date(wibDayRange().start.getTime() + (undian.voucherValidDays + 1) * DAY_MS - 1);
      const logIds: string[] = [];

      for (const w of winners) {
        const voucher = await tx.voucher.create({
          data: {
            code: await this.uniqueCode(tx),
            memberId: w.memberId,
            discountType: undian.discountType,
            discountValue: undian.discountValue,
            maxDiscountCap: undian.maxDiscountCap,
            minPurchase: undian.minPurchase,
            expiresAt,
            source: 'undian',
            undianId,
            note: `Menang undian: ${undian.title}`,
            createdById: actorId,
          },
        });
        const phone = waPhone(w.member.phone);
        if (!phone) continue;
        const log = await this.whatsapp.createPendingTx(tx, {
          memberId: w.memberId,
          kind: WhatsappMessageKind.menang_undian,
          phone,
          message: winnerMessage(w.member.name, undian, voucher.code, expiresAt),
          dedupeKey: `voucher:${voucher.id}`,
        });
        if (log) logIds.push(log.id);
      }

      await tx.undian.update({ where: { id: undianId }, data: { status: 'selesai', drawnAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'undian.draw',
          target: undianId,
          detail: { winnerCount: undian.winnerCount },
        },
      });
      return { result: { ok: true, undianId, winnerCount: undian.winnerCount }, logIds };
    });

    // Kirim WA SETELAH commit (pola sama RemindersService) — gagal kirim gak
    // ngebatalin undian, statusnya kecatat di whatsapp_logs (bisa retry).
    for (const id of logIds) {
      await this.whatsapp.sendPendingLog(id).catch((e) => this.logger.warn(`Gagal kirim WA undian (log ${id}): ${e}`));
    }
    return result;
  }

  async cancel(undianId: string, actorId: string) {
    const { count } = await this.prisma.undian.updateMany({
      where: { id: undianId, status: 'berjalan' },
      data: { status: 'dibatalkan' },
    });
    if (count === 0) throw new BadRequestException('Undian tidak ditemukan atau sudah tidak bisa dibatalkan');
    await this.prisma.auditLog.create({
      data: { actorUid: actorId, action: 'undian.cancel', target: undianId, detail: {} },
    });
    return { ok: true };
  }

  /** Kunci baris undian (FOR UPDATE) & pastikan masih 'berjalan'. */
  private async lockBerjalan(tx: Prisma.TransactionClient, undianId: string, action: string) {
    const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM undian WHERE id = ${undianId} FOR UPDATE`;
    if (!row) throw new NotFoundException('Undian tidak ditemukan');
    const undian = await tx.undian.findUniqueOrThrow({ where: { id: undianId } });
    if (undian.status !== 'berjalan') throw new BadRequestException(`Undian ini sudah ${undian.status} — ${action}`);
    return undian;
  }

  /** Cek dulu sebelum insert: P2002 di dalam transaksi ngebatalin transaksinya. */
  private async uniqueCode(tx: Prisma.TransactionClient): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = randomVoucherCode();
      if (!(await tx.voucher.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
    throw new BadRequestException('Gagal membuat kode voucher unik, coba lagi');
  }
}

/** Port teks build_voucher_wa_body (source 'undian') dari migrasi Supabase 0027. */
function winnerMessage(
  name: string,
  u: { title: string; discountType: string; discountValue: number; maxDiscountCap: number | null; minPurchase: number | null },
  code: string,
  expiresAt: Date,
): string {
  const desc =
    u.discountType === 'persen'
      ? `${u.discountValue}%` + (u.maxDiscountCap != null ? ` (maks potongan Rp ${u.maxDiscountCap})` : '')
      : `Rp ${u.discountValue}`;
  let syarat = '';
  if (u.minPurchase != null) syarat += `\n- Minimal belanja Rp ${u.minPurchase}`;
  syarat += `\n- Berlaku sampai ${formatTanggalId(wibDateOnly(expiresAt))}`;
  syarat += `\n- Menang undian: ${u.title}`; // = catatan voucher, sama kayak RPC
  return (
    `Selamat ${name}! Anda MENANG undian dan berhak potongan harga ${desc}.\n\n` +
    `Kode voucher Anda: ${code}\n` +
    `Tunjukkan/sebutkan kode ini saat membeli di toko kami.\n` +
    `Syarat & ketentuan:${syarat}\n\n— Ayub Podo Rukun`
  );
}
