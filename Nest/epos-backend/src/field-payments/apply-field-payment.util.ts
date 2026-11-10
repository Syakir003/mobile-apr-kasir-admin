import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, type Prisma } from '@prisma/client';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import { STATUS_VERIFIED } from './field-payment.constants';

type Tx = Prisma.TransactionClient;

export interface FieldPaymentToApply {
  id: string;
  invoiceId: string;
  method: string;
  amount: unknown;
  proofUrl: string | null;
  receiptNumber: string;
  recordedById: string;
}

/**
 * Menjadikan SATU pembayaran lapangan sebagai pelunasan resmi (dipakai verifikasi setoran tunai dan pencocokan mutasi):
 * membuat ManualPayment, menghitung ulang `total_paid`/`status` invoice (dikunci FOR UPDATE), lalu menandai pembayaran
 * lapangan `diverifikasi`. Harga bisa turun sesudah Tanda Terima terbit (admin menyimpan harga baru, pembatalan unit) sehingga
 * nominal > sisa tagihan nyata: hanya sebesar sisa yang diterapkan, kelebihannya dicatat di buku besar teknisi sebagai
 * `kelebihan_pelanggan` (BUKAN utang teknisi; perlu dikembalikan ke pelanggan, belum ada refund otomatis).
 * Pemanggil WAJIB sudah mengunci order terkait (urutan kunci order -> invoice).
 */
export async function applyFieldPaymentTx(
  tx: Tx,
  fp: FieldPaymentToApply,
  adminId: string,
  opts: { settlementId?: string | null },
): Promise<{ applied: number; excess: number; invoiceStatus: InvoiceStatus; manualPaymentId: string | null }> {
  const rows = await tx.$queryRaw<{ id: string; grand_total: string; total_paid: string; status: InvoiceStatus }[]>`
    SELECT id, grand_total, total_paid, status FROM invoices WHERE id = ${fp.invoiceId} FOR UPDATE`;
  const inv = rows[0];
  if (!inv) throw new NotFoundException('Invoice tidak ditemukan');
  if (inv.status === InvoiceStatus.batal || inv.status === InvoiceStatus.refund) {
    throw new BadRequestException(`Invoice sudah batal/refund, ${fp.receiptNumber} tidak bisa diverifikasi`);
  }

  const grand = Number(inv.grand_total);
  const paid = Number(inv.total_paid);
  const amount = Number(fp.amount);
  const remaining = Math.max(0, grand - paid);
  const applied = Math.min(amount, remaining);
  const excess = amount - applied;

  let manualPaymentId: string | null = null;
  let invoiceStatus: InvoiceStatus = inv.status;
  if (applied > 0) {
    const payment = await tx.manualPayment.create({
      data: {
        invoiceId: fp.invoiceId,
        method: fp.method,
        amount: applied,
        note: `Pembayaran lapangan ${fp.receiptNumber}`,
        proofUrl: fp.proofUrl,
        createdById: adminId,
        // Uang tidak lewat laci kasir (dibawa teknisi / langsung ke rekening toko), jadi tidak masuk shift mana pun.
        shiftId: null,
      },
    });
    manualPaymentId = payment.id;
    const newPaid = paid + applied;
    invoiceStatus = computeInvoiceStatus(grand, newPaid, inv.status);
    await tx.invoice.update({ where: { id: fp.invoiceId }, data: { totalPaid: newPaid, status: invoiceStatus } });
  }
  if (excess > 0) {
    await tx.technicianCashEntry.create({
      data: {
        technicianId: fp.recordedById,
        settlementId: opts.settlementId ?? null,
        kind: 'kelebihan_pelanggan',
        amount: excess,
        note: `Kelebihan ${fp.receiptNumber}: tagihan turun/sudah lunas setelah Tanda Terima terbit, perlu dikembalikan ke pelanggan`,
        createdById: adminId,
      },
    });
  }

  await tx.fieldPayment.update({
    where: { id: fp.id },
    data: {
      status: STATUS_VERIFIED,
      manualPaymentId,
      verifiedById: adminId,
      verifiedAt: new Date(),
      settlementId: opts.settlementId ?? null,
    },
  });
  await tx.auditLog.create({
    data: {
      actorUid: adminId,
      action: 'field_payment.verify',
      target: fp.id,
      detail: { receiptNumber: fp.receiptNumber, applied, excess, settlementId: opts.settlementId ?? null, invoiceStatus },
    },
  });
  return { applied, excess, invoiceStatus, manualPaymentId };
}
