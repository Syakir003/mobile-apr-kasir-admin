import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;
type Role = 'admin' | 'kasir' | 'teknisi' | 'gudang';

/**
 * Gerbang Ajukan Selesai untuk order `bayar_di_lokasi`: teknisi wajib sudah mencatat pembayaran (selain yang ditolak admin)
 * ATAU menulis alasan (mis. pelanggan belum bisa membayar; disimpan di `service_orders.unpaid_reason` untuk admin).
 * Tidak berlaku untuk admin, pemasangan, komplain, order `ditagih_admin`, order tanpa invoice, dan tagihan Rp 0 / sudah lunas.
 */
export async function assertPaymentRecordedOrExplained(
  tx: Tx,
  job: { id: string; orderId: string; type: string; complaintOfJobId: string | null },
  role: Role,
  unpaidReason?: string,
): Promise<void> {
  if (role === 'admin') return;
  if (job.type === 'pemasangan' || job.complaintOfJobId) return;
  const order = await tx.serviceOrder.findUnique({
    where: { id: job.orderId },
    select: { paymentMode: true, invoiceId: true },
  });
  if (!order || order.paymentMode !== 'bayar_di_lokasi' || !order.invoiceId) return;

  const recorded = await tx.fieldPayment.count({ where: { orderId: job.orderId, status: { not: 'ditolak' } } });
  if (recorded > 0) return;

  const inv = await tx.invoice.findUnique({ where: { id: order.invoiceId }, select: { grandTotal: true, totalPaid: true } });
  if (!inv || Number(inv.grandTotal) - Number(inv.totalPaid) <= 0) return;

  const reason = unpaidReason?.trim() ?? '';
  if (reason.length >= 5) {
    await tx.serviceOrder.update({ where: { id: job.orderId }, data: { unpaidReason: reason } });
    return;
  }
  throw new BadRequestException(
    'Order ini dibayar di lokasi: catat pembayaran dulu, atau isi alasan bila pelanggan belum bisa membayar.',
  );
}
