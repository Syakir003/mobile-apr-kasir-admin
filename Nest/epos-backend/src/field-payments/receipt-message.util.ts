import { METHOD_LABEL, type FieldPaymentMethod } from './field-payment.constants';

const dateWib = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Tanda Terima yang dikirim teknisi ke pelanggan (WA nomor toko). SENGAJA singkat dan tanpa tautan: ini bukti uang sudah
 * diterima di lokasi, BUKAN faktur. Faktur resmi (bertautan struk) dikirim admin kemudian.
 */
export function buildReceiptMessage(p: {
  receiptNumber: string;
  amount: number;
  method: FieldPaymentMethod;
  customerName: string;
  serviceSummary: string;
  paidAt: Date;
  technicianName: string;
}): string {
  const rp = `Rp ${Math.round(p.amount).toLocaleString('id-ID')}`;
  return [
    `Tanda Terima ${p.receiptNumber}`,
    `AYUB AC menerima ${rp} (${METHOD_LABEL[p.method] ?? p.method}) dari ${p.customerName}`,
    `untuk ${p.serviceSummary}, ${dateWib.format(p.paidAt)}. Teknisi: ${p.technicianName}.`,
    'Faktur menyusul dari admin.',
  ].join('\n');
}
