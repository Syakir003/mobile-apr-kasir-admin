import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { wibDateOnly, wibDayRange } from '../common/wib-date.util';
import { applyFieldPaymentTx } from './apply-field-payment.util';
import { RepayDto, SettleDto } from './dto/settlement.dto';
import { STATUS_AWAITING_MATCH, STATUS_HELD, STATUS_REJECTED, STATUS_VERIFIED } from './field-payment.constants';

type Db = Prisma.TransactionClient;

/** Jenis buku besar yang membentuk saldo teknisi (positif = teknisi berutang ke toko). */
const BALANCE_KINDS = ['kurang_setor', 'lebih_setor', 'pelunasan'];

const rp = (n: number) => `Rp ${Math.abs(n).toLocaleString('id-ID')}`;

/** Saldo kurang-setor teknisi saat ini (positif = teknisi berutang ke toko). */
async function ledgerBalance(db: Db, technicianId: string): Promise<number> {
  const agg = await db.technicianCashEntry.aggregate({
    where: { technicianId, kind: { in: BALANCE_KINDS } },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
}

/**
 * Setoran harian dan verifikasi pembayaran lapangan (admin). Setoran tunai memverifikasi sekumpulan pembayaran milik satu
 * teknisi sekaligus dan mencatat selisihnya; pembayaran non-tunai dicocokkan satu per satu dengan mutasi rekening/QRIS toko.
 * Urutan kunci: service_orders (urut id) -> users (bila ada buku besar) -> invoices (urut id, di applyFieldPaymentTx).
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Bahan layar Setoran untuk satu teknisi: semua tunai yang masih dipegang (termasuk hari-hari sebelumnya), total yang
   * seharusnya disetor, saldo kurang-setor, dan daftar periksa sparepart yang harus kembali (pengajuan disetujui pada
   * tanggal itu: disetujui - terpakai).
   */
  async pending(technicianId: string, date?: string) {
    const tech = await this.prisma.user.findUnique({
      where: { id: technicianId },
      select: { id: true, displayName: true, role: true },
    });
    if (!tech || tech.role !== 'teknisi') throw new NotFoundException('Teknisi tidak ditemukan');
    const ref = date ? new Date(`${date}T12:00:00+07:00`) : new Date();
    if (Number.isNaN(ref.getTime())) throw new BadRequestException('Tanggal tidak valid (format YYYY-MM-DD)');
    const day = wibDayRange(ref);

    const [payments, saldo, requests] = await Promise.all([
      this.prisma.fieldPayment.findMany({
        where: { recordedById: technicianId, status: STATUS_HELD },
        orderBy: { createdAt: 'asc' },
        include: { invoice: { select: { number: true, customerName: true } } },
      }),
      ledgerBalance(this.prisma, technicianId),
      this.prisma.materialRequest.findMany({
        where: { createdById: technicianId, status: 'approved', decidedAt: { gte: day.start, lte: day.end } },
        include: { items: true, job: { select: { member: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const now = Date.now();
    const rows = payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      amount: Number(p.amount),
      method: p.method,
      invoiceNumber: p.invoice.number,
      customerName: p.invoice.customerName,
      proofUrl: p.proofUrl,
      receiptChannel: p.receiptChannel,
      source: p.source,
      createdAt: p.createdAt,
      ageDays: Math.floor((now - p.createdAt.getTime()) / 86400000),
    }));
    return {
      technician: { id: tech.id, displayName: tech.displayName },
      date: day.start.toISOString().slice(0, 10),
      payments: rows,
      expectedTotal: rows.reduce((s, r) => s + r.amount, 0),
      saldo,
      sparepartReturns: requests.map((r) => ({
        requestId: r.id,
        customerName: r.job?.member?.name ?? null,
        items: r.items.map((i) => {
          const approved = Number(i.qty);
          const used = i.qtyUsed === null ? approved : Number(i.qtyUsed);
          return { name: i.name, unit: i.unit, approved, used, toReturn: Math.max(0, approved - used) };
        }),
      })),
    };
  }

  /** Setoran tunai: verifikasi pembayaran yang dicentang, bandingkan dengan uang diterima, catat selisihnya. */
  async settle(dto: SettleDto, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const first = await tx.fieldPayment.findMany({ where: { id: { in: dto.paymentIds } } });
      if (first.length !== new Set(dto.paymentIds).size) throw new BadRequestException('Ada pembayaran yang tidak ditemukan');

      // Kunci semua order terkait (urut id) SEBELUM membaca ulang status; invoice dikunci kemudian di applyFieldPaymentTx.
      const orderIds = [...new Set(first.map((p) => p.orderId))].sort();
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id IN (${Prisma.join(orderIds)}) ORDER BY id FOR UPDATE`;

      const fps = await tx.fieldPayment.findMany({ where: { id: { in: dto.paymentIds } } });
      if (fps.length !== first.length) throw new BadRequestException('Ada pembayaran yang tidak ditemukan');
      for (const p of fps) {
        if (p.recordedById !== dto.technicianId) {
          throw new BadRequestException(`${p.receiptNumber} bukan milik teknisi ini`);
        }
        if (p.method !== 'tunai') {
          throw new BadRequestException(`${p.receiptNumber} bukan tunai; pembayaran non-tunai dicocokkan dengan mutasi, bukan lewat setoran`);
        }
        if (p.status !== STATUS_HELD) throw new BadRequestException(`${p.receiptNumber} sudah diproses (${p.status})`);
      }

      const expected = fps.reduce((s, p) => s + Number(p.amount), 0);
      const difference = dto.receivedTotal - expected;
      let mode: SettleDto['mode'] | null = null;
      const reason = dto.reason?.trim() ?? '';
      if (difference !== 0) {
        if (!dto.mode) {
          throw new BadRequestException(
            `Ada selisih ${rp(difference)} (${difference < 0 ? 'kurang' : 'lebih'} dari ${rp(expected)}). ` +
              'Pilih: catat sebagai saldo teknisi, atau selesai dengan alasan.',
          );
        }
        if (dto.mode === 'catat_kurang' && difference > 0) throw new BadRequestException('Uang yang diterima lebih besar; pilih catat lebih');
        if (dto.mode === 'catat_lebih' && difference < 0) throw new BadRequestException('Uang yang diterima lebih kecil; pilih catat kurang');
        if (dto.mode === 'selesai_dengan_alasan' && reason.length < 10) {
          throw new BadRequestException('Alasan selisih wajib diisi konkret (min. 10 karakter)');
        }
        mode = dto.mode;
        // Buku besar teknisi diubah: serialkan dengan pelunasan lain atas teknisi yang sama.
        await tx.$executeRaw`SELECT id FROM users WHERE id = ${dto.technicianId} FOR UPDATE`;
      }

      const settlement = await tx.cashSettlement.create({
        data: {
          technicianId: dto.technicianId,
          businessDate: wibDateOnly(new Date()),
          expectedTotal: expected,
          receivedTotal: dto.receivedTotal,
          difference,
          mode,
          reason: mode === 'selesai_dengan_alasan' ? reason : null,
          note: dto.note?.trim() || null,
          sparepartNote: dto.sparepartNote?.trim() || null,
          createdById: adminId,
        },
      });

      // Pelunasan resmi per pembayaran (urut invoiceId supaya urutan kunci invoice konsisten antar setoran).
      const results: ({ paymentId: string; receiptNumber: string } & Awaited<ReturnType<typeof applyFieldPaymentTx>>)[] = [];
      for (const p of [...fps].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId) || a.id.localeCompare(b.id))) {
        const r = await applyFieldPaymentTx(tx, p, adminId, { settlementId: settlement.id });
        results.push({ paymentId: p.id, receiptNumber: p.receiptNumber, ...r });
      }

      if (mode === 'catat_kurang' || mode === 'catat_lebih') {
        await tx.technicianCashEntry.create({
          data: {
            technicianId: dto.technicianId,
            settlementId: settlement.id,
            kind: mode === 'catat_kurang' ? 'kurang_setor' : 'lebih_setor',
            amount: -difference, // kurang (difference < 0) -> positif = teknisi berutang
            note: dto.note?.trim() || null,
            createdById: adminId,
          },
        });
      } else if (mode === 'selesai_dengan_alasan') {
        await tx.technicianCashEntry.create({
          data: {
            technicianId: dto.technicianId,
            settlementId: settlement.id,
            kind: 'ditutup_alasan',
            amount: Math.abs(difference),
            note: reason,
            createdById: adminId,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUid: adminId,
            action: 'settlement.difference_closed',
            target: settlement.id,
            detail: { technicianId: dto.technicianId, difference, reason },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUid: adminId,
          action: 'settlement.create',
          target: settlement.id,
          detail: {
            technicianId: dto.technicianId,
            paymentIds: fps.map((p) => p.id),
            expectedTotal: expected,
            receivedTotal: dto.receivedTotal,
            difference,
            mode,
          },
        },
      });

      return {
        settlementId: settlement.id,
        expectedTotal: expected,
        receivedTotal: dto.receivedTotal,
        difference,
        mode,
        results,
        saldo: await ledgerBalance(tx, dto.technicianId),
      };
    });
  }

  /** Teknisi melunasi kekurangan setor belakangan (mengurangi saldo; tidak boleh melebihi saldo). */
  async repay(dto: RepayDto, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM users WHERE id = ${dto.technicianId} FOR UPDATE`;
      const saldo = await ledgerBalance(tx, dto.technicianId);
      if (saldo <= 0) throw new BadRequestException('Teknisi ini tidak punya saldo kurang setor');
      if (dto.amount > saldo) {
        throw new BadRequestException(`Pelunasan ${rp(dto.amount)} melebihi saldo kurang setor ${rp(saldo)}`);
      }
      await tx.technicianCashEntry.create({
        data: {
          technicianId: dto.technicianId,
          kind: 'pelunasan',
          amount: -dto.amount,
          note: dto.note?.trim() || null,
          createdById: adminId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUid: adminId,
          action: 'settlement.repay',
          target: dto.technicianId,
          detail: { amount: dto.amount, saldoSebelum: saldo, saldoSesudah: saldo - dto.amount },
        },
      });
      return { saldoSebelum: saldo, saldoSesudah: saldo - dto.amount };
    });
  }

  /** Pencocokan mutasi (non-tunai): admin menemukan transfer/QRIS-nya di rekening toko -> dilunasi. */
  async verify(paymentId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.fieldPayment.findUnique({ where: { id: paymentId } });
      if (!ref) throw new NotFoundException('Pembayaran tidak ditemukan');
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${ref.orderId} FOR UPDATE`;
      const fp = await tx.fieldPayment.findUnique({ where: { id: paymentId } });
      if (!fp) throw new NotFoundException('Pembayaran tidak ditemukan');
      if (fp.status === STATUS_HELD) {
        throw new BadRequestException('Pembayaran tunai diverifikasi lewat Setoran, bukan pencocokan mutasi');
      }
      if (fp.status !== STATUS_AWAITING_MATCH) throw new BadRequestException(`Pembayaran sudah diproses (${fp.status})`);
      return applyFieldPaymentTx(tx, fp, adminId, { settlementId: null });
    });
  }

  /** Tolak pembayaran (transfer tidak ditemukan di mutasi, atau tunai yang salah catat). Teknisi dikabari. */
  async reject(paymentId: string, reasonRaw: string, adminId: string) {
    const reason = reasonRaw.trim();
    if (reason.length < 5) throw new BadRequestException('Alasan penolakan wajib diisi (min. 5 karakter)');
    const fp = await this.prisma.$transaction(async (tx) => {
      const ref = await tx.fieldPayment.findUnique({ where: { id: paymentId } });
      if (!ref) throw new NotFoundException('Pembayaran tidak ditemukan');
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${ref.orderId} FOR UPDATE`;
      const cur = await tx.fieldPayment.findUnique({ where: { id: paymentId } });
      if (!cur) throw new NotFoundException('Pembayaran tidak ditemukan');
      if (cur.status === STATUS_VERIFIED || cur.status === STATUS_REJECTED) {
        throw new BadRequestException(`Pembayaran sudah diproses (${cur.status})`);
      }
      await tx.fieldPayment.update({
        where: { id: paymentId },
        data: { status: STATUS_REJECTED, rejectReason: reason, verifiedById: adminId, verifiedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUid: adminId,
          action: 'field_payment.reject',
          target: paymentId,
          detail: { receiptNumber: cur.receiptNumber, amount: Number(cur.amount), reason },
        },
      });
      return cur;
    });
    void this.notifications
      .notify(fp.recordedById, {
        title: 'Pembayaran Lapangan Ditolak',
        body: `${fp.receiptNumber} (${rp(Number(fp.amount))}) ditolak admin: ${reason}`,
        type: 'field_payment_rejected',
        target: paymentId,
      })
      .catch(() => undefined);
    return { ok: true, paymentId, status: STATUS_REJECTED };
  }
}
