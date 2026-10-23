export interface WaInvoiceItem {
  kind: string;
  name: string;
  unit: string | null;
  qty: unknown;
  unitPrice: unknown;
  lineTotal: unknown;
}

export interface WaInvoiceData {
  number: string;
  createdAt: Date;
  subtotal: unknown;
  discount: unknown;
  taxPercent: unknown;
  taxAmount: unknown;
  transportFee: unknown;
  grandTotal: unknown;
  totalPaid: unknown;
  status: string;
  items: WaInvoiceItem[];
  adjustments: { reason: string | null; requestId: string | null }[];
}

const BULAN_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/** "Rp1.260.000", sama dengan format rupiah di struk. */
export function rp(value: unknown): string {
  return `Rp${Math.round(Number(value)).toLocaleString('id-ID')}`;
}

function qtyText(qty: unknown): string {
  return String(Number(qty));
}

/** Tanggal dan jam dalam WIB: { tanggal: "22 Oktober 2026", waktu: "13.39 WIB" }. */
export function wibDateParts(date: Date): { tanggal: string; waktu: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    tanggal: `${get('day')} ${BULAN_ID[Number(get('month')) - 1]} ${get('year')}`,
    waktu: `${get('hour')}.${get('minute')} WIB`,
  };
}

export function invoiceStatusLabel(status: string): string {
  if (status === 'lunas') return 'Lunas';
  if (status === 'dp') return 'DP (belum lunas)';
  if (status === 'kurang_bayar') return 'Kurang bayar';
  return 'Belum lunas';
}

/**
 * Isian untuk template pesan WhatsApp invoice (gaya nota): daftar barang, rincian biaya,
 * dan ringkasan pembayaran. Rumus rincian sama dengan struk di web (summarize di
 * receipt-view), jadi angka di WhatsApp dan di struk selalu sama.
 */
export function buildInvoiceWaValues(
  inv: WaInvoiceData,
): Record<string, string> {
  const grand = Number(inv.grandTotal);
  const paid = Number(inv.totalPaid);
  const sisa = Math.max(0, grand - paid);
  const discount = Number(inv.discount);
  const tax = Number(inv.taxAmount);
  const transport = Number(inv.transportFee);
  const tambahan = Math.round(
    grand - (Number(inv.subtotal) - discount + tax + transport),
  );

  const item = inv.items
    .map((it) => {
      const included = it.kind === 'product' && Number(it.lineTotal) === 0;
      const unit = it.unit ? ` ${it.unit}` : '';
      return (
        `✅ ${it.name}${included ? ' (termasuk paket)' : ''}\n` +
        `   ${qtyText(it.qty)}${unit} x ${rp(it.unitPrice)} = ${rp(it.lineTotal)}`
      );
    })
    .join('\n');

  const discountReason = inv.adjustments
    .filter((a) => !a.requestId)
    .map((a) => a.reason)
    .filter(Boolean)
    .join(', ');
  const rincian = [`Total tagihan : ${rp(inv.subtotal)}`];
  if (discount > 0)
    rincian.push(
      `Diskon${discountReason ? ` (${discountReason})` : ''} : - ${rp(discount)}`,
    );
  if (tax > 0) rincian.push(`Pajak (${qtyText(inv.taxPercent)}%) : ${rp(tax)}`);
  if (transport > 0) rincian.push(`Biaya transport : ${rp(transport)}`);
  if (tambahan !== 0) rincian.push(`Tambahan sparepart : ${rp(tambahan)}`);
  rincian.push(`*Grand total : ${rp(grand)}*`);

  let pembayaran: string;
  if (inv.status === 'lunas') pembayaran = `*Lunas*, dibayar ${rp(paid)}`;
  else if (paid > 0)
    pembayaran = `Dibayar : ${rp(paid)}\nSisa tagihan : *${rp(sisa)}*`;
  else pembayaran = `Sisa tagihan : *${rp(sisa)}*`;

  const { tanggal, waktu } = wibDateParts(inv.createdAt);
  return {
    nomor: inv.number,
    tanggal,
    waktu,
    item,
    rincian: rincian.join('\n'),
    pembayaran,
    total: rp(grand),
    status: invoiceStatusLabel(inv.status),
  };
}
