import { dateKey } from "../units/barcode";

export type InvoiceStatus = "belum_dibayar" | "dp" | "lunas";

/**
 * Format nomor invoice: INV-YYYYMMDD-XXXX
 * seq dipad 4 digit.
 */
export function formatInvoiceNumber(date: Date, seq: number): string {
  const key = dateKey(date);
  const seqStr = String(seq).padStart(4, "0");
  return `INV-${key}-${seqStr}`;
}

/**
 * Hitung status invoice.
 *
 * - totalPaid <= 0 && grandTotal > 0 → belum_dibayar
 * - totalPaid < grandTotal → dp
 * - totalPaid >= grandTotal → lunas (termasuk grandTotal 0)
 */
export function computeInvoiceStatus(
  grandTotal: number,
  totalPaid: number
): InvoiceStatus {
  if (totalPaid <= 0 && grandTotal > 0) {
    return "belum_dibayar";
  }
  if (totalPaid < grandTotal) {
    return "dp";
  }
  return "lunas";
}
