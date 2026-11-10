import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TechnicianJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { isJobAssignee } from '../technician-jobs/job-assignees';
import { CreateFieldPaymentDto } from './dto/create-field-payment.dto';
import { ACTIVE_FIELD_PAYMENT_STATUSES, STATUS_AWAITING_MATCH, STATUS_HELD } from './field-payment.constants';

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
    return this.prisma.$transaction(async (tx) => {
      if (dto.clientRef) {
        const dup = await tx.fieldPayment.findUnique({ where: { clientRef: dto.clientRef } });
        if (dup) {
          if (dup.recordedById !== actorId) throw new BadRequestException('clientRef sudah dipakai');
          return { payment: dup, duplicate: true };
        }
      }
      const job = await tx.technicianJob.findUnique({
        where: { id: jobId },
        select: { id: true, orderId: true, type: true, status: true, complaintOfJobId: true },
      });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      if (!(await isJobAssignee(tx, jobId, actorId))) throw new ForbiddenException('Job ini bukan milik Anda');

      // Kunci order dulu (urutan sama dengan setWithin/cancel): dua teknisi satu order tidak menagih bersamaan.
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${job.orderId} FOR UPDATE`;
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
      return { payment, duplicate: false };
    });
  }
}
