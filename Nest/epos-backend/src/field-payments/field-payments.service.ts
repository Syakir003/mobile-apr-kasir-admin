import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TechnicianJobStatus, WhatsappMessageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { waPhone } from '../whatsapp/wa-format.util';
import { isJobAssignee } from '../technician-jobs/job-assignees';
import { CreateFieldPaymentDto } from './dto/create-field-payment.dto';
import { SendReceiptDto } from './dto/send-receipt.dto';
import { buildReceiptMessage } from './receipt-message.util';
import {
  ACTIVE_FIELD_PAYMENT_STATUSES,
  STATUS_AWAITING_MATCH,
  STATUS_HELD,
  STATUS_REJECTED,
  type FieldPaymentMethod,
} from './field-payment.constants';

type Db = Prisma.TransactionClient;
interface JobGateRef {
  id: string;
  orderId: string;
  type: string;
  status: string;
  complaintOfJobId: string | null;
}

/**
 * Alasan pembayaran lapangan BELUM boleh dicatat untuk job ini (reason = null → boleh), plus id invoice order.
 * Satu fungsi dipakai `record` (menolak) dan ringkasan layar teknisi (menjelaskan kenapa tombol tertutup).
 * Gerbang sparepart: total tagihan harus sudah final sebelum menagih (lapor terpakai bisa menurunkan total).
 */
export async function gateReason(db: Db, job: JobGateRef): Promise<{ reason: string | null; invoiceId: string | null }> {
  if (job.type === 'pemasangan') return { reason: 'Pemasangan dibayar lewat kasir, bukan dicatat teknisi', invoiceId: null };
  if (job.complaintOfJobId) return { reason: 'Job komplain tidak ditagih', invoiceId: null };
  if (job.status !== TechnicianJobStatus.sedang_dikerjakan) {
    return { reason: 'Pembayaran hanya bisa dicatat saat job Sedang Dikerjakan', invoiceId: null };
  }
  const order = await db.serviceOrder.findUnique({ where: { id: job.orderId }, select: { paymentMode: true, invoiceId: true } });
  if (!order) return { reason: 'Order tidak ditemukan', invoiceId: null };
  if (order.paymentMode !== 'bayar_di_lokasi') {
    return { reason: 'Order ini ditagih admin, pembayaran tidak dicatat teknisi', invoiceId: order.invoiceId };
  }
  if (!order.invoiceId) return { reason: 'Harga jasa belum ditetapkan admin, belum bisa menagih', invoiceId: null };
  const jobs = await db.technicianJob.findMany({ where: { orderId: job.orderId }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  const pending = await db.materialRequest.count({ where: { jobId: { in: jobIds }, status: 'pending' } });
  if (pending > 0) {
    return { reason: 'Masih ada pengajuan sparepart yang belum diputuskan admin. Tunggu keputusannya dulu sebelum menagih', invoiceId: order.invoiceId };
  }
  const unused = await db.materialRequest.count({ where: { jobId: { in: jobIds }, status: 'approved', usedAt: null } });
  if (unused > 0) {
    return { reason: 'Laporkan pemakaian sparepart yang disetujui (tandai dipakai) dulu sebelum menagih', invoiceId: order.invoiceId };
  }
  return { reason: null, invoiceId: order.invoiceId };
}

/** Nomor layak dikirimi WhatsApp: hasil normalisasi minimal 10 karakter (mis. "1" -> "621" tidak layak, "-" -> kosong). */
function canSendWhatsapp(raw: string | null | undefined): boolean {
  return waPhone(raw).length >= 10;
}

/** Decimal Prisma menjadi string di JSON; respons API konsisten memakai angka untuk `amount`. */
function withNumericAmount<T extends { amount: unknown }>(p: T): Omit<T, 'amount'> & { amount: number } {
  return { ...p, amount: Number(p.amount) };
}

@Injectable()
export class FieldPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /**
   * Teknisi (assignee) mencatat pembayaran yang ia terima di lokasi. TIDAK mengubah invoice (total_paid/status): baru
   * dihitung setelah admin memverifikasi (rencana setoran). Nominal dibatasi sisa tagihan dikurangi pembayaran lapangan
   * yang masih aktif; pembayaran sebagian wajib dicatat. Idempoten lewat `clientRef`.
   */
  async record(jobId: string, dto: CreateFieldPaymentDto, proofUrl: string, actorId: string) {
    try {
      return await this.recordOnce(jobId, dto, proofUrl, actorId);
    } catch (e) {
      // Jaring pengaman idempotensi: unique clientRef bentrok (mis. clientRef yang sama dipakai untuk order lain, di luar
      // kunci order). Postgres membatalkan seluruh transaksi yang kena unique violation, jadi pencarian ulang HARUS lewat
      // koneksi biasa, bukan di dalam transaksi tadi.
      if (dto.clientRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const dup = await this.prisma.fieldPayment.findUnique({ where: { clientRef: dto.clientRef } });
        if (dup && dup.recordedById === actorId) return { payment: withNumericAmount(dup), duplicate: true };
      }
      throw e;
    }
  }

  private async recordOnce(jobId: string, dto: CreateFieldPaymentDto, proofUrl: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // orderId tidak pernah berubah, jadi boleh dibaca sebelum kunci. SEMUA kondisi lain (status job, assignee, clientRef,
      // gerbang) dibaca SESUDAH kunci order supaya tidak basi: pembatalan/penagihan lain yang berbarengan sudah selesai.
      const ref = await tx.technicianJob.findUnique({ where: { id: jobId }, select: { orderId: true } });
      if (!ref) throw new NotFoundException('Job tidak ditemukan');

      // Kunci order dulu (urutan sama dengan setWithin/cancel): dua teknisi satu order tidak menagih bersamaan.
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${ref.orderId} FOR UPDATE`;

      if (dto.clientRef) {
        const dup = await tx.fieldPayment.findUnique({ where: { clientRef: dto.clientRef } });
        if (dup) {
          if (dup.recordedById !== actorId) throw new BadRequestException('clientRef sudah dipakai');
          return { payment: withNumericAmount(dup), duplicate: true };
        }
      }
      const job = await tx.technicianJob.findUnique({
        where: { id: jobId },
        select: { id: true, orderId: true, type: true, status: true, complaintOfJobId: true },
      });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      if (!(await isJobAssignee(tx, jobId, actorId))) throw new ForbiddenException('Job ini bukan milik Anda');

      const gate = await gateReason(tx, job);
      if (gate.reason || !gate.invoiceId) throw new BadRequestException(gate.reason ?? 'Harga jasa belum ditetapkan admin');
      const invoiceId = gate.invoiceId;

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
      if (dto.amount > remaining) {
        throw new BadRequestException(`Melebihi sisa tagihan (sisa Rp ${remaining.toLocaleString('id-ID')})`);
      }
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
          recordedById: actorId,
          method: dto.method,
          amount: dto.amount,
          note,
          proofUrl,
          // Tunai: uang dibawa teknisi. Non-tunai: tidak ada uang dibawa; admin mencocokkan dengan mutasi/notifikasi toko.
          status: dto.method === 'tunai' ? STATUS_HELD : STATUS_AWAITING_MATCH,
          receiptNumber,
          clientRef: dto.clientRef ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'field_payment.create',
          target: payment.id,
          detail: { jobId, orderId: job.orderId, invoiceId, method: dto.method, amount: dto.amount, receiptNumber },
        },
      });
      // Pembayaran sudah tercatat: alasan "belum bisa bayar" dari Ajukan Selesai (bila ada) tidak berlaku lagi, supaya admin
      // tidak menagih pelanggan yang sebenarnya sudah membayar.
      await tx.serviceOrder.update({ where: { id: job.orderId }, data: { unpaidReason: null } });
      return { payment: withNumericAmount(payment), duplicate: false };
    });
  }

  /**
   * Kirim Tanda Terima ke pelanggan lewat nomor toko (WA), atau tandai pakai laporan kertas. Hanya perekam (atau admin).
   * Gagal kirim WA tidak melempar: hasil `sent:false` + alasan, teknisi boleh kirim ulang atau pilih kertas.
   */
  async sendReceipt(paymentId: string, dto: SendReceiptDto, actorId: string, role: string) {
    const fp = await this.prisma.fieldPayment.findUnique({
      where: { id: paymentId },
      include: { invoice: { include: { member: true } }, recordedBy: { select: { displayName: true } } },
    });
    if (!fp) throw new NotFoundException('Pembayaran tidak ditemukan');
    if (role !== 'admin' && fp.recordedById !== actorId) throw new ForbiddenException('Pembayaran ini bukan catatan Anda');
    if (fp.status === STATUS_REJECTED) throw new BadRequestException('Pembayaran ini sudah ditolak admin');

    if (dto.channel === 'kertas') {
      const paperReportNo = dto.paperReportNo?.trim() || null;
      await this.prisma.fieldPayment.update({ where: { id: paymentId }, data: { receiptChannel: 'kertas', paperReportNo } });
      await this.prisma.auditLog.create({
        data: { actorUid: actorId, action: 'field_payment.receipt_sent', target: paymentId, detail: { channel: 'kertas', paperReportNo } },
      });
      return { sent: false, channel: 'kertas' as const, receiptNumber: fp.receiptNumber };
    }

    const rawPhone = fp.invoice.customerPhone || fp.invoice.member?.phone || '';
    if (!canSendWhatsapp(rawPhone)) {
      throw new BadRequestException('Nomor HP pelanggan belum ada atau tidak valid. Pakai laporan kertas sebagai bukti.');
    }
    const items = await this.prisma.invoiceItem.findMany({
      // Baris "Biaya transport" juga kind 'service' (JobBillingService) tetapi bukan pekerjaan yang dibayar pelanggan.
      where: { invoiceId: fp.invoiceId, kind: 'service', name: { not: 'Biaya transport' } },
      select: { name: true, qty: true },
    });
    const names = [...new Set(items.map((i) => (Number(i.qty) > 1 ? `${i.name} (${Number(i.qty)})` : i.name)))];
    const serviceSummary = names.length > 0 ? names.slice(0, 3).join(', ') + (names.length > 3 ? ', dll.' : '') : 'servis AC';
    const message = buildReceiptMessage({
      receiptNumber: fp.receiptNumber,
      amount: Number(fp.amount),
      method: fp.method as FieldPaymentMethod,
      customerName: fp.invoice.customerName || fp.invoice.member?.name || 'Pelanggan',
      serviceSummary,
      paidAt: fp.createdAt,
      technicianName: fp.recordedBy.displayName,
    });
    const log = await this.whatsapp.sendInvoiceMessage({
      invoiceId: fp.invoiceId,
      memberId: fp.invoice.memberId,
      phone: rawPhone,
      message,
      actorId,
      kind: WhatsappMessageKind.tanda_terima,
    });
    const sent = log.status === 'terkirim';
    await this.prisma.fieldPayment.update({
      where: { id: paymentId },
      data: { receiptWaLogId: log.id, ...(sent ? { receiptChannel: 'wa', receiptSentAt: new Date() } : {}) },
    });
    if (sent) {
      await this.prisma.auditLog.create({
        data: { actorUid: actorId, action: 'field_payment.receipt_sent', target: paymentId, detail: { channel: 'wa', logId: log.id } },
      });
    }
    // Alasan asli dari penyedia (log.error) hanya tersimpan di log WA untuk admin; teknisi menerima pesan umum.
    return {
      sent,
      channel: 'wa' as const,
      receiptNumber: fp.receiptNumber,
      error: sent ? null : 'Gagal mengirim WhatsApp. Coba lagi, atau pakai laporan kertas.',
    };
  }

  /** Ringkasan pembayaran lapangan satu order untuk layar job: daftar, sisa efektif, dan apakah/kenapa tombol Catat Pembayaran tertutup. */
  async listForJob(jobId: string, actorId: string, role: string) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      select: { id: true, orderId: true, type: true, status: true, complaintOfJobId: true },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    if (role === 'teknisi' && !(await isJobAssignee(this.prisma, jobId, actorId))) {
      throw new ForbiddenException('Job ini bukan milik Anda');
    }
    const [payments, order, gate] = await Promise.all([
      this.prisma.fieldPayment.findMany({
        where: { orderId: job.orderId },
        orderBy: { createdAt: 'asc' },
        include: { recordedBy: { select: { id: true, displayName: true } } },
      }),
      this.prisma.serviceOrder.findUnique({
        where: { id: job.orderId },
        select: {
          paymentMode: true,
          unpaidReason: true,
          invoice: {
            select: {
              id: true, number: true, status: true, grandTotal: true, totalPaid: true,
              customerPhone: true, member: { select: { phone: true } },
            },
          },
        },
      }),
      gateReason(this.prisma, job),
    ]);
    const active = ACTIVE_FIELD_PAYMENT_STATUSES as readonly string[];
    const activeTotal = payments.filter((p) => active.includes(p.status)).reduce((s, p) => s + Number(p.amount), 0);
    const remaining = order?.invoice ? Number(order.invoice.grandTotal) - Number(order.invoice.totalPaid) - activeTotal : null;
    const blockedReason = gate.reason ?? (remaining !== null && remaining <= 0 ? 'Tagihan sudah terbayar penuh' : null);
    return {
      paymentMode: order?.paymentMode ?? null,
      unpaidReason: order?.unpaidReason ?? null,
      // Nomor HP pelanggan tidak dikirim ke layar teknisi; cukup tanda apakah Tanda Terima bisa dikirim lewat WhatsApp.
      canSendWa: canSendWhatsapp(order?.invoice?.customerPhone || order?.invoice?.member?.phone),
      invoice: order?.invoice
        ? {
            id: order.invoice.id,
            number: order.invoice.number,
            status: order.invoice.status,
            grandTotal: Number(order.invoice.grandTotal),
            totalPaid: Number(order.invoice.totalPaid),
          }
        : null,
      activeTotal,
      remaining,
      canRecord: blockedReason === null,
      blockedReason,
      payments: payments.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        method: p.method,
        amount: Number(p.amount),
        note: p.note,
        status: p.status,
        proofUrl: p.proofUrl,
        receiptChannel: p.receiptChannel,
        receiptSentAt: p.receiptSentAt,
        createdAt: p.createdAt,
        recordedBy: p.recordedBy,
      })),
    };
  }

  /** Catatan pembayaran milik teknisi yang login (uang yang ia pegang = status dipegang_teknisi). */
  async mine(actorId: string, status?: string) {
    const [rows, held] = await Promise.all([
      this.prisma.fieldPayment.findMany({
        where: { recordedById: actorId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { invoice: { select: { number: true, customerName: true } } },
      }),
      // Total uang yang masih dipegang dihitung atas SEMUA catatan teknisi (daftar di atas dibatasi 200 baris terbaru, jadi
      // uang tunai lama yang belum disetor tidak boleh hilang dari total).
      this.prisma.fieldPayment.aggregate({
        where: { recordedById: actorId, status: STATUS_HELD },
        _sum: { amount: true },
      }),
    ]);
    return {
      heldTotal: Number(held._sum.amount ?? 0),
      items: rows.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        method: r.method,
        amount: Number(r.amount),
        status: r.status,
        receiptChannel: r.receiptChannel,
        receiptSentAt: r.receiptSentAt,
        createdAt: r.createdAt,
        invoiceNumber: r.invoice.number,
        customerName: r.invoice.customerName,
      })),
    };
  }
}
