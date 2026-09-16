import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ShiftsService } from '../shifts/shifts.service';

/**
 * Port dari record_payment RPC (definisi ulang di payment_approval_photo_rules.sql).
 * PENTING (koreksi dari plan awal): sistem asli TIDAK punya langkah verifikasi
 * terpisah (menunggu_verifikasi/terverifikasi) — kasir/admin input pembayaran
 * dan LANGSUNG ke-apply ke invoice. Kasir dipercaya karena dia yang pegang
 * uang/bukti transfer secara langsung saat itu juga.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: ShiftsService, // Siklus 4 — atribusi shift ke pembayaran
  ) {}

  async record(invoiceId: string, dto: RecordPaymentDto, actorId: string) {
    // Cari-saja (bukan mutasi) — sengaja DI LUAR $transaction utama, gak perlu ikut
    // lock invoice. Kalau kasir/admin gak punya shift aktif, tetap lanjut (opsional,
    // shiftId disimpan null — checkout/bayar TIDAK BOLEH gagal gara-gara ini).
    const openShift = await this.shifts.findOpenShiftForKasir(actorId);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; grand_total: string; total_paid: string; status: string }[]
      >`SELECT id, grand_total, total_paid, status FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
      const inv = rows[0];
      if (!inv) throw new NotFoundException('Invoice tidak ditemukan');

      if (inv.status === 'batal' || inv.status === 'refund') {
        throw new BadRequestException('Invoice sudah batal/refund');
      }
      const grand = Number(inv.grand_total);
      const paid = Number(inv.total_paid);
      const remaining = grand - paid;
      if (dto.amount > remaining) {
        throw new BadRequestException('Melebihi sisa tagihan');
      }

      const payment = await tx.manualPayment.create({
        data: {
          invoiceId,
          method: dto.method,
          amount: dto.amount,
          note: dto.note,
          proofUrl: dto.proofUrl,
          createdById: actorId,
          shiftId: openShift?.id ?? null,
        },
      });

      const newPaid = paid + dto.amount;
      const newStatus = computeInvoiceStatus(grand, newPaid, inv.status as any);
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { totalPaid: newPaid, status: newStatus },
      });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'pos.payment',
          target: invoiceId,
          detail: { amount: dto.amount, status: newStatus },
        },
      });

      return { paymentId: payment.id, status: newStatus, totalPaid: newPaid };
    });
  }
}
