import * as React from 'react';

import { formatRupiah } from '@/lib/format';

// Tampilan struk (kertas thermal 58mm, area cetak ~48mm). Dipakai halaman cetak internal
// (/invoices/[id]/print) dan halaman publik pelanggan (/struk/[token]).
export interface ReceiptData {
  number: string;
  createdAt: string;
  customerName: string | null;
  // Opsional: halaman publik sengaja tidak menerima HP, alamat, dan catatan.
  customerPhone?: string | null;
  address?: string | null;
  notes?: string | null;
  items: { kind: string; name: string; unit: string | null; qty: string; unitPrice: string; lineTotal: string }[];
  subtotal: string;
  discount: string;
  taxPercent: string;
  taxAmount: string;
  transportFee: string;
  grandTotal: string;
  totalPaid: string;
  status: string;
  // Diskon ad-hoc/voucher (requestId null) dan tambahan dari pengajuan sparepart teknisi (requestId terisi).
  adjustments?: { reason: string | null; requestId: string | null }[];
}

export function formatDateTime(value: string): string {
  const d = new Date(value);
  const two = (n: number) => n.toString().padStart(2, '0');
  return `${two(d.getDate())}-${two(d.getMonth() + 1)}-${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function trimZero(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : v;
}

/** Angka di bawah barang (diskon, pajak, ongkir, tambahan) supaya barang + rincian = TOTAL. */
export function summarize(data: ReceiptData) {
  const grand = Number(data.grandTotal);
  const discount = Number(data.discount);
  const tax = Number(data.taxAmount);
  const transport = Number(data.transportFee);
  const paid = Number(data.totalPaid);
  const tambahan = Math.round(grand - (Number(data.subtotal) - discount + tax + transport));
  const discountReason = (data.adjustments ?? [])
    .filter((a) => !a.requestId)
    .map((a) => a.reason)
    .filter(Boolean)
    .join(', ');

  const extras: { key: string; label: string; value: string }[] = [];
  if (discount > 0) extras.push({ key: 'diskon', label: `Diskon${discountReason ? ` (${discountReason})` : ''}`, value: `- ${formatRupiah(discount)}` });
  if (tax > 0) extras.push({ key: 'pajak', label: `Pajak (${trimZero(data.taxPercent)}%)`, value: formatRupiah(tax) });
  if (transport > 0) extras.push({ key: 'transport', label: 'Biaya transport', value: formatRupiah(transport) });
  if (tambahan !== 0) extras.push({ key: 'tambahan', label: 'Tambahan sparepart', value: formatRupiah(tambahan) });
  return { grand, paid, sisa: Math.max(0, grand - paid), extras };
}

const Dash = () => <div className="my-3 border-t border-dashed border-black" />;

function Line({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 py-px">
      <span>{left}</span>
      <span className="ml-auto text-right">{right}</span>
    </div>
  );
}

/** `zoom`: pembesar di layar saja (saat cetak kembali 1 lewat CSS .struk-sheet). */
export function ReceiptView({ data, zoom = 1.5 }: { data: ReceiptData; zoom?: number }) {
  const { grand, paid, sisa, extras } = summarize(data);
  return (
    <div
      className="struk-sheet mx-auto w-[48mm] max-w-full bg-white p-2 font-mono text-[11px] leading-relaxed text-black shadow print:p-0 print:shadow-none"
      style={{ zoom }}
    >
      <div className="space-y-0.5 text-center">
        {/* Logo diproses hitam-putih berkontras supaya tegas di printer thermal. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-apr-hd.png"
          alt="APR"
          className="mx-auto mb-2 h-auto w-[24mm]"
          style={{ filter: 'grayscale(1) contrast(1.8)' }}
        />
        <p className="text-lg tracking-wide">AYUB AC</p>
        <p className="text-[11px]">Penjualan • Service • Spare Part • Rental AC</p>
        <p className="text-[11px]">JL. GUNUNG ANYAR RT. 01 RW. 06</p>
        <p className="text-[11px]">KEL. GUNUNG GEDANGAN - MOJOKERTO</p>
        <p className="text-[11px]">Telp. 0857 332 7112 - 0822 3388 9990</p>
        <p className="text-[11px]">0321 - 325831</p>
      </div>

      <Dash />
      <Line left="No" right={data.number} />
      <Line left="Tanggal" right={formatDateTime(data.createdAt)} />
      {data.customerName && <Line left="Pelanggan" right={data.customerName} />}
      {data.customerPhone && <Line left="Telp" right={data.customerPhone} />}
      {data.address && <p className="mt-1 break-words text-[11px]">Alamat: {data.address}</p>}
      <Dash />

      {data.items.map((item, i) => {
        const included = item.kind === 'product' && Number(item.lineTotal) === 0;
        return (
          <div key={i} className="mb-2.5 break-inside-avoid">
            <p className="break-words">
              {item.name}
              {included ? ' (termasuk paket)' : ''}
            </p>
            <p>
              {trimZero(item.qty)}
              {item.unit ? ` ${item.unit}` : ''} x {formatRupiah(item.unitPrice)}
            </p>
            <p className="text-right">{formatRupiah(item.lineTotal)}</p>
          </div>
        );
      })}

      {extras.length > 0 && (
        <>
          <Dash />
          {extras.map((e) => (
            <Line key={e.key} left={e.label} right={e.value} />
          ))}
        </>
      )}

      <Dash />
      <Line left="TOTAL" right={formatRupiah(grand)} />
      {data.status === 'lunas' ? (
        <p className="mt-1.5 text-center">*** LUNAS ***</p>
      ) : (
        paid > 0 && (
          <>
            <Line left={data.status === 'dp' ? 'DP' : 'Dibayar'} right={formatRupiah(paid)} />
            <Line left="SISA TAGIHAN" right={formatRupiah(sisa)} />
          </>
        )
      )}
      <Dash />

      {data.notes && <p className="mb-2 break-words text-[11px]">Catatan: {data.notes}</p>}
      <div className="space-y-1 text-[10px]">
        <p>* Barang yang sudah dibeli tidak dapat ditukar atau dikembalikan.</p>
        <p>* Transfer ke Rek. ANDRIAS WARDOYO BCA 0501826391</p>
        <p>* Jangan memberi tip kepada petugas kami. Bayarlah sesuai jumlah di atas.</p>
        <p>* Suara Konsumen 082233889990.</p>
      </div>
      <Dash />
      <p className="text-center">TERIMA KASIH</p>
      <p className="text-center text-[11px]">Hormat kami, Ayub AC</p>
    </div>
  );
}
