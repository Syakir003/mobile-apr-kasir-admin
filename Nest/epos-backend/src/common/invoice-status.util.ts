import { InvoiceStatus } from '@prisma/client';

/**
 * Port 1:1 dari `compute_invoice_status(grand, paid, current?)` di
 * payment_approval_photo_rules.sql (definisi ulang dari versi awal di
 * pos_functions.sql). "Sadar-status" / sticky: begitu invoice pernah
 * `kurang_bayar` (invoice yang tadinya lunas lalu tagihannya naik lagi
 * karena pengajuan sparepart di-approve), status itu BERTAHAN sampai lunas
 * lagi — tidak boleh turun jadi `dp` biasa. `batal`/`refund` sengaja tidak
 * dihitung ulang oleh fungsi ini (dijaga terpisah di pemanggilnya, sama
 * seperti record_payment yang menolak invoice batal/refund sebelum sampai
 * ke fungsi ini).
 */
export function computeInvoiceStatus(
  grandTotal: number,
  totalPaid: number,
  current?: InvoiceStatus | null,
): InvoiceStatus {
  if (totalPaid >= grandTotal) return InvoiceStatus.lunas;
  if (totalPaid <= 0) return InvoiceStatus.belum_dibayar;
  if (current === InvoiceStatus.kurang_bayar) return InvoiceStatus.kurang_bayar;
  return InvoiceStatus.dp;
}
