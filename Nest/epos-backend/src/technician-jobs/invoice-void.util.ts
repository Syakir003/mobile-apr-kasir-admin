import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, Prisma, TechnicianJobStatus } from '@prisma/client';

type Tx = Prisma.TransactionClient;
interface JobRef {
  id: string;
  orderId: string;
  type: string;
}

// Invoice servis yang dihargai di depan sudah ada sebelum pekerjaan selesai. Bila SEMUA job order dibatalkan, invoice itu
// dibatalkan (status `batal`, nomor + riwayat tetap ada) supaya tidak jadi invoice kosong. Pemasangan POS tidak disentuh:
// invoicenya adalah penjualan. Belum ada refund, jadi bila invoice sudah menerima pembayaran, pembatalan job terakhir ditolak.

async function lockInvoice(tx: Tx, invoiceId: string) {
  const rows = await tx.$queryRaw<{ id: string; grand_total: string; total_paid: string; status: InvoiceStatus }[]>`
    SELECT id, grand_total, total_paid, status FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
  return rows[0] ?? null;
}

/** Kunci order + semua job-nya (urut id) SEBELUM menghitung "job terakhir" dan mengunci invoice. Urutan kunci sama dengan
 * ServicePricingService.setWithin dan ServiceOrdersService.update (order -> job -> invoice): dua pembatalan bersamaan tidak
 * sama-sama melihat "masih ada job lain" (invoice kosong tak jadi batal) dan tidak ada celah deadlock. */
async function lockOrderJobs(tx: Tx, orderId: string) {
  await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${orderId} FOR UPDATE`;
  await tx.$executeRaw`SELECT id FROM technician_jobs WHERE order_id = ${orderId} ORDER BY id FOR UPDATE`;
}

/** Invoice servis order ini; null untuk pemasangan POS atau order yang belum punya invoice. Order + job-nya ikut terkunci. */
async function serviceInvoiceId(tx: Tx, job: JobRef): Promise<string | null> {
  if (job.type === 'pemasangan') return null;
  await lockOrderJobs(tx, job.orderId);
  const order = await tx.serviceOrder.findUnique({ where: { id: job.orderId }, select: { invoiceId: true } });
  return order?.invoiceId ?? null;
}

async function isLastActiveJob(tx: Tx, job: JobRef): Promise<boolean> {
  const others = await tx.technicianJob.count({
    where: { orderId: job.orderId, id: { not: job.id }, status: { not: TechnicianJobStatus.dibatalkan } },
  });
  return others === 0;
}

/** Dipanggil SEBELUM job dibatalkan: job terakhir tidak boleh dibatalkan bila invoice sudah punya pembayaran. */
export async function assertLastJobCancelAllowed(tx: Tx, job: JobRef): Promise<void> {
  const invoiceId = await serviceInvoiceId(tx, job);
  if (!invoiceId || !(await isLastActiveJob(tx, job))) return;
  const inv = await lockInvoice(tx, invoiceId);
  if (inv && Number(inv.total_paid) > 0) {
    throw new BadRequestException(
      'Invoice order ini sudah punya pembayaran, jadi job terakhirnya tidak bisa dibatalkan (sistem belum punya refund). Selesaikan job-nya, atau tunggu fitur refund.',
    );
  }
}

/** Dipanggil SETELAH job dibatalkan dan tagihannya dihitung ulang. Mengembalikan true bila invoice dibatalkan. */
export async function voidInvoiceIfOrderCancelled(tx: Tx, job: JobRef, actorId: string): Promise<boolean> {
  const invoiceId = await serviceInvoiceId(tx, job);
  if (!invoiceId || !(await isLastActiveJob(tx, job))) return false;
  const inv = await lockInvoice(tx, invoiceId);
  if (!inv || inv.status === InvoiceStatus.batal || inv.status === InvoiceStatus.refund || Number(inv.total_paid) > 0) {
    return false;
  }
  // Masih ada tagihan (mis. sparepart jalur penyesuaian lama yang sudah terpakai): jangan dibatalkan diam-diam, biar tetap
  // terlihat sebagai piutang. Invoice yang baru berisi jasa di depan bernilai 0 setelah baris job-nya dihitung ulang.
  if (Number(inv.grand_total) > 0) return false;
  await tx.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.batal } });
  await tx.auditLog.create({
    data: {
      actorUid: actorId,
      action: 'invoice.void_on_cancel',
      target: invoiceId,
      detail: { orderId: job.orderId, jobId: job.id },
    },
  });
  return true;
}
