import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isJobAssignee } from '../technician-jobs/job-assignees';
import { formatTanggalId } from '../whatsapp/wa-format.util';
import { wibDateOnly, wibDayRange } from '../common/wib-date.util';
import { applyFieldPaymentTx } from './apply-field-payment.util';
import { FromPaperDto, RepayDto, SettleDto } from './dto/settlement.dto';
import {
  ACTIVE_FIELD_PAYMENT_STATUSES,
  STATUS_AWAITING_MATCH,
  STATUS_HELD,
  STATUS_REJECTED,
  STATUS_VERIFIED,
} from './field-payment.constants';

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

interface AnchorJob {
  jobId: string;
  jobStatus: string;
  unitCount: number;
  unitLabel: string;
}

/**
 * Job "utama" tiap order untuk membuka laporan pekerjaannya dari daftar setoran: job pertama yang tidak dibatalkan (pembayaran
 * dicatat per ORDER, bukan per unit), plus jumlah unit aktif dan ringkasan unit pertama ("Merk Model (Ruang) +N unit").
 */
async function anchorJobs(db: Db | PrismaService, orderIds: string[]): Promise<Map<string, AnchorJob>> {
  const result = new Map<string, AnchorJob>();
  if (orderIds.length === 0) return result;
  const jobs = await db.technicianJob.findMany({
    where: { orderId: { in: orderIds } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      orderId: true,
      status: true,
      unit: { select: { brand: true, model: true, roomLocation: true } },
    },
  });
  for (const orderId of orderIds) {
    const own = jobs.filter((j) => j.orderId === orderId);
    const live = own.filter((j) => j.status !== 'dibatalkan');
    const anchor = live[0] ?? own[0];
    if (!anchor) continue;
    const u = anchor.unit;
    const label = u ? `${[u.brand, u.model].filter(Boolean).join(' ') || 'Unit AC'}${u.roomLocation ? ` (${u.roomLocation})` : ''}` : 'Servis';
    const count = Math.max(1, live.length);
    result.set(orderId, {
      jobId: anchor.id,
      jobStatus: anchor.status,
      unitCount: count,
      unitLabel: count > 1 ? `${label} +${count - 1} unit` : label,
    });
  }
  return result;
}

/**
 * Setoran harian dan verifikasi pembayaran lapangan (admin). Setoran tunai memverifikasi sekumpulan pembayaran milik satu
 * teknisi sekaligus dan mencatat selisihnya; pembayaran non-tunai dicocokkan satu per satu dengan mutasi rekening/QRIS toko.
 * Urutan kunci: service_orders (urut id) -> users (bila ada buku besar) -> invoices (urut id, di applyFieldPaymentTx).
 */
@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly counters: CountersService,
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
    const anchors = await anchorJobs(this.prisma, [...new Set(payments.map((p) => p.orderId))]);
    const rows = payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      // Job utama order ini: tautan untuk membuka laporan pekerjaan sebelum uangnya diverifikasi.
      jobId: anchors.get(p.orderId)?.jobId ?? null,
      jobStatus: anchors.get(p.orderId)?.jobStatus ?? null,
      unitLabel: anchors.get(p.orderId)?.unitLabel ?? null,
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
      date: wibDateOnly(ref).toISOString().slice(0, 10),
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

  /**
   * Semua pembayaran lapangan yang BELUM terverifikasi (tunai dipegang teknisi + non-tunai menunggu dicocokkan), tertua dulu,
   * masing-masing dengan job utama ordernya. Dipakai tab "Setoran Teknisi" di Antrian Servis: admin membuka job untuk melihat
   * laporan pekerjaan sambil memverifikasi uangnya. `technicians` = ringkasan per teknisi untuk chip filter.
   */
  async outstanding() {
    const rows = await this.prisma.fieldPayment.findMany({
      where: { status: { in: [...ACTIVE_FIELD_PAYMENT_STATUSES] } },
      orderBy: { createdAt: 'asc' },
      include: {
        invoice: { select: { number: true, customerName: true } },
        recordedBy: { select: { id: true, displayName: true } },
      },
    });
    const anchors = await anchorJobs(this.prisma, [...new Set(rows.map((r) => r.orderId))]);
    const now = Date.now();
    const items = rows.map((r) => {
      const a = anchors.get(r.orderId);
      return {
        paymentId: r.id,
        receiptNumber: r.receiptNumber,
        method: r.method,
        amount: Number(r.amount),
        status: r.status,
        proofUrl: r.proofUrl,
        source: r.source,
        createdAt: r.createdAt,
        ageDays: Math.floor((now - r.createdAt.getTime()) / 86400000),
        orderId: r.orderId,
        jobId: a?.jobId ?? null,
        jobStatus: a?.jobStatus ?? null,
        unitCount: a?.unitCount ?? 1,
        unitLabel: a?.unitLabel ?? null,
        invoiceNumber: r.invoice.number,
        customerName: r.invoice.customerName,
        technician: r.recordedBy,
      };
    });
    const byTech = new Map<string, { technicianId: string; displayName: string; heldTotal: number; awaitingTotal: number; orders: Set<string>; paymentCount: number }>();
    for (const i of items) {
      const t =
        byTech.get(i.technician.id) ??
        { technicianId: i.technician.id, displayName: i.technician.displayName, heldTotal: 0, awaitingTotal: 0, orders: new Set<string>(), paymentCount: 0 };
      if (i.status === STATUS_HELD) t.heldTotal += i.amount;
      else t.awaitingTotal += i.amount;
      t.orders.add(i.orderId);
      t.paymentCount += 1;
      byTech.set(i.technician.id, t);
    }
    const technicians = [...byTech.values()]
      .map(({ orders, ...t }) => ({ ...t, orderCount: orders.size }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { items, technicians };
  }

  /** Setoran tunai: verifikasi pembayaran yang dicentang, bandingkan dengan uang diterima, catat selisihnya. */
  async settle(dto: SettleDto, adminId: string) {
    // Banyak pembayaran = banyak query dalam satu transaksi interaktif; bawaan Prisma 5 detik bisa terlewati bila DB jauh.
    return this.prisma.$transaction(
      async (tx) => {
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
        await tx.$executeRaw`SELECT id FROM users WHERE id = ${dto.technicianId} FOR NO KEY UPDATE`;
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
      },
      { timeout: 20000 },
    );
  }

  /** Teknisi melunasi kekurangan setor belakangan (mengurangi saldo; tidak boleh melebihi saldo). */
  async repay(dto: RepayDto, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM users WHERE id = ${dto.technicianId} FOR NO KEY UPDATE`;
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

  /**
   * Admin mencatat pembayaran atas nama teknisi dari lembar laporan kertas (kasus tanpa sinyal). Batas sisa tagihan dan aturan
   * pembayaran sebagian sama dengan pencatatan teknisi, tetapi tanpa gerbang status job/sparepart: admin yang memutuskan.
   * Hasilnya berstatus sama seperti catatan teknisi (tunai = dipegang_teknisi, non-tunai = menunggu_cocok) lalu diverifikasi
   * lewat alur yang sama. Tanda Terima ditandai `kertas`; foto bukti tidak wajib.
   */
  async fromPaper(dto: FromPaperDto, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.technicianJob.findUnique({
        where: { id: dto.jobId },
        select: { orderId: true, type: true, complaintOfJobId: true },
      });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      if (job.type === 'pemasangan') {
        throw new BadRequestException('Pemasangan dibayar lewat kasir, bukan dicatat dari laporan teknisi');
      }
      if (job.complaintOfJobId) throw new BadRequestException('Job komplain tidak ditagih');

      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${job.orderId} FOR UPDATE`;
      if (dto.clientRef) {
        const dup = await tx.fieldPayment.findUnique({ where: { clientRef: dto.clientRef } });
        if (dup) {
          if (dup.recordedById !== dto.technicianId) throw new BadRequestException('clientRef sudah dipakai');
          return { payment: { ...dup, amount: Number(dup.amount) }, duplicate: true };
        }
      }
      if (!(await isJobAssignee(tx, dto.jobId, dto.technicianId))) {
        throw new BadRequestException('Teknisi ini bukan petugas job tersebut');
      }
      const order = await tx.serviceOrder.findUnique({ where: { id: job.orderId }, select: { invoiceId: true } });
      if (!order?.invoiceId) throw new BadRequestException('Harga jasa belum ditetapkan, belum ada tagihan untuk dibayar');
      const invoiceId = order.invoiceId;

      const rows = await tx.$queryRaw<{ id: string; grand_total: string; total_paid: string; status: string }[]>`
        SELECT id, grand_total, total_paid, status FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
      const inv = rows[0];
      if (!inv) throw new NotFoundException('Invoice tidak ditemukan');
      if (inv.status === 'batal' || inv.status === 'refund') throw new BadRequestException('Invoice sudah batal/refund');
      const active = await tx.fieldPayment.aggregate({
        where: { invoiceId, status: { in: [...ACTIVE_FIELD_PAYMENT_STATUSES] } },
        _sum: { amount: true },
      });
      const remaining = Number(inv.grand_total) - Number(inv.total_paid) - Number(active._sum.amount ?? 0);
      if (remaining <= 0) throw new BadRequestException('Tagihan sudah terbayar penuh (termasuk yang menunggu setoran)');
      if (dto.amount > remaining) throw new BadRequestException(`Melebihi sisa tagihan (sisa ${rp(remaining)})`);
      const note = dto.note?.trim() || null;
      if (dto.amount < remaining && (!note || note.length < 3)) {
        throw new BadRequestException('Pembayaran sebagian wajib diberi catatan (mis. DP, sisanya dibayar kapan)');
      }

      const dateKey = this.counters.dateKey(new Date());
      const seq = await this.counters.nextSeq(tx, `tanda_terima_${dateKey}`);
      const receiptNumber = `TT-${dateKey}-${String(seq).padStart(4, '0')}`;
      const payment = await tx.fieldPayment.create({
        data: {
          invoiceId,
          orderId: job.orderId,
          recordedById: dto.technicianId,
          method: dto.method,
          amount: dto.amount,
          note,
          proofUrl: null,
          status: dto.method === 'tunai' ? STATUS_HELD : STATUS_AWAITING_MATCH,
          receiptNumber,
          clientRef: dto.clientRef ?? null,
          receiptChannel: 'kertas',
          paperReportNo: dto.paperReportNo?.trim() || null,
          source: 'kertas',
          enteredById: adminId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUid: adminId,
          action: 'field_payment.create',
          target: payment.id,
          detail: {
            source: 'kertas',
            technicianId: dto.technicianId,
            jobId: dto.jobId,
            orderId: job.orderId,
            invoiceId,
            method: dto.method,
            amount: dto.amount,
            receiptNumber,
          },
        },
      });
      return { payment: { ...payment, amount: Number(payment.amount) }, duplicate: false };
    });
  }

  /** Antrean pencocokan mutasi: semua pembayaran non-tunai yang menunggu admin, tertua dulu. */
  async awaiting() {
    const rows = await this.prisma.fieldPayment.findMany({
      where: { status: STATUS_AWAITING_MATCH },
      orderBy: { createdAt: 'asc' },
      include: {
        invoice: { select: { number: true, customerName: true } },
        recordedBy: { select: { id: true, displayName: true } },
      },
    });
    const items = rows.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      method: r.method,
      amount: Number(r.amount),
      proofUrl: r.proofUrl,
      createdAt: r.createdAt,
      invoiceNumber: r.invoice.number,
      customerName: r.invoice.customerName,
      technician: r.recordedBy,
    }));
    return { items, total: items.reduce((s, i) => s + i.amount, 0) };
  }

  /**
   * Laporan "Uang di Teknisi": per teknisi — tunai yang masih dipegang (+ umur tertua), pembayaran menunggu dicocokkan,
   * saldo kurang-setor, selisih yang ditutup dengan alasan 30 hari terakhir (supaya pola berulang terlihat), dan
   * kelebihan pelanggan yang perlu dikembalikan. Teknisi nonaktif ikut tampil bila masih memegang uang/saldo.
   */
  async technicianCash(now: Date = new Date()) {
    const since = new Date(now.getTime() - 30 * 86400000);
    const [held, awaiting, ledger, closed] = await Promise.all([
      this.prisma.fieldPayment.groupBy({
        by: ['recordedById'],
        where: { status: STATUS_HELD },
        _sum: { amount: true },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
      this.prisma.fieldPayment.groupBy({
        by: ['recordedById'],
        where: { status: STATUS_AWAITING_MATCH },
        _count: { _all: true },
      }),
      this.prisma.technicianCashEntry.groupBy({
        by: ['technicianId', 'kind'],
        where: { kind: { in: [...BALANCE_KINDS, 'kelebihan_pelanggan'] } },
        _sum: { amount: true },
      }),
      this.prisma.technicianCashEntry.groupBy({
        by: ['technicianId'],
        where: { kind: 'ditutup_alasan', createdAt: { gte: since } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    const involved = new Set<string>([
      ...held.map((h) => h.recordedById),
      ...awaiting.map((a) => a.recordedById),
      ...ledger.map((l) => l.technicianId),
      ...closed.map((c) => c.technicianId),
    ]);
    const people = await this.prisma.user.findMany({
      where: { OR: [{ role: 'teknisi', active: true }, { id: { in: [...involved] } }] },
      select: { id: true, displayName: true },
    });
    return people
      .map((p) => {
        const h = held.find((x) => x.recordedById === p.id);
        const oldest = h?._min.createdAt ?? null;
        const entries = ledger.filter((l) => l.technicianId === p.id);
        const closedRow = closed.find((c) => c.technicianId === p.id);
        return {
          technicianId: p.id,
          displayName: p.displayName,
          heldTotal: Number(h?._sum.amount ?? 0),
          heldCount: h?._count._all ?? 0,
          oldestHeldAgeDays: oldest ? Math.floor((now.getTime() - oldest.getTime()) / 86400000) : null,
          awaitingCount: awaiting.find((a) => a.recordedById === p.id)?._count._all ?? 0,
          saldo: entries.filter((l) => BALANCE_KINDS.includes(l.kind)).reduce((s, l) => s + Number(l._sum.amount ?? 0), 0),
          closedWithReason30d: { count: closedRow?._count._all ?? 0, total: Number(closedRow?._sum.amount ?? 0) },
          excessCustomer: entries
            .filter((l) => l.kind === 'kelebihan_pelanggan')
            .reduce((s, l) => s + Number(l._sum.amount ?? 0), 0),
        };
      })
      .sort((a, b) => b.heldTotal - a.heldTotal || a.displayName.localeCompare(b.displayName));
  }

  /** Cron harian 09.00 WIB: kabari admin tentang uang tunai teknisi yang dibuat sebelum hari ini dan belum disetor. */
  @Cron('0 9 * * *', { timeZone: 'Asia/Jakarta' })
  async runCashOverdue() {
    try {
      await this.notifyAdminsCashOverdue();
    } catch (e) {
      this.logger.warn(`Notifikasi uang tertahan gagal: ${e}`);
    }
  }

  /**
   * Satu notifikasi `cash_overdue` per admin per teknisi per hari (aman dijalankan ulang). `target` = id teknisi.
   * Mengembalikan jumlah notifikasi yang dibuat.
   */
  async notifyAdminsCashOverdue(now: Date = new Date()): Promise<number> {
    const todayStart = wibDayRange(now).start;
    const groups = await this.prisma.fieldPayment.groupBy({
      by: ['recordedById'],
      where: { status: STATUS_HELD, createdAt: { lt: todayStart } },
      _sum: { amount: true },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    if (groups.length === 0) return 0;
    const [admins, techs] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'admin', active: true }, select: { id: true } }),
      this.prisma.user.findMany({
        where: { id: { in: groups.map((g) => g.recordedById) } },
        select: { id: true, displayName: true },
      }),
    ]);
    let created = 0;
    for (const g of groups) {
      const name = techs.find((t) => t.id === g.recordedById)?.displayName ?? 'Teknisi';
      for (const admin of admins) {
        const sudah = await this.prisma.notification.findFirst({
          where: { userId: admin.id, type: 'cash_overdue', target: g.recordedById, createdAt: { gte: todayStart } },
          select: { id: true },
        });
        if (sudah) continue;
        await this.notifications.notify(admin.id, {
          title: `Uang di teknisi belum disetor: ${name}`,
          body: `${g._count._all} pembayaran tunai ${rp(Number(g._sum.amount ?? 0))}, tertua ${formatTanggalId(wibDateOnly(g._min.createdAt ?? now))}.`,
          type: 'cash_overdue',
          target: g.recordedById,
        });
        created += 1;
      }
    }
    return created;
  }
}
