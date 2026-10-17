'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { Button } from '@/components/ui/button';

interface InvoiceItem {
  id: string;
  kind: string;
  refId: string | null;
  name: string;
  unit: string | null;
  qty: string;
  unitPrice: string;
  lineTotal: string;
}
interface InvoiceDetail {
  id: string;
  number: string;
  customerName: string | null;
  customerPhone: string | null;
  subtotal: string;
  discount: string;
  taxPercent: string;
  taxAmount: string;
  transportFee: string;
  grandTotal: string;
  totalPaid: string;
  status: string;
  notes: string | null;
  createdAt: string;
  items: InvoiceItem[];
  // Penyesuaian invoice: diskon ad-hoc/voucher (requestId null) dan tambahan
  // dari pengajuan sparepart teknisi (requestId terisi).
  adjustments?: { reason: string | null; amount: string; requestId: string | null }[];
  member: { address: string | null } | null;
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  const two = (n: number) => n.toString().padStart(2, '0');
  return `${two(d.getDate())}-${two(d.getMonth() + 1)}-${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function trimZero(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : v;
}

const Dash = () => <div className="my-3 border-t border-dashed border-black" />;

function Line({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-px">
      <span>{left}</span>
      <span className="whitespace-nowrap text-right">{right}</span>
    </div>
  );
}

// Struk kasir (printer thermal 80mm). Dulu halaman ini replika formulir invoice A4 bercetak.
export function InvoicePrintClient({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => apiClient.get<InvoiceDetail>(`/invoices/${invoiceId}`),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat struk...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat struk.</p>;

  // Rincian di bawah barang (diskon, pajak, ongkir, tambahan) supaya angka di
  // kertas SELALU cocok: barang + rincian = TOTAL.
  const grand = Number(data.grandTotal);
  const discount = Number(data.discount);
  const tax = Number(data.taxAmount);
  const transport = Number(data.transportFee);
  const paid = Number(data.totalPaid);
  const sisa = Math.max(0, grand - paid);
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

  return (
    <div className="mx-auto w-[80mm] max-w-full">
      {/* Kertas thermal 80mm, tinggi mengikuti isi. Untuk printer 58mm ganti 80mm -> 58mm. */}
      <style>{'@page { size: 80mm auto; margin: 3mm; } @media print { body { background: #fff; } }'}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" asChild>
          <Link href="/pos">
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak Struk
        </Button>
      </div>

      <div className="bg-white p-2 font-mono text-[12px] leading-relaxed text-black shadow print:p-0 print:shadow-none">
        <div className="space-y-0.5 text-center">
          {/* Logo diproses hitam-putih berkontras supaya tegas di printer thermal. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-apr-hd.png"
            alt="APR"
            className="mx-auto mb-2 h-auto w-[30mm]"
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
        {data.member?.address && <p className="mt-1 break-words text-[11px]">Alamat: {data.member.address}</p>}
        <Dash />

        {data.items.map((item) => {
          const included = item.kind === 'product' && Number(item.lineTotal) === 0;
          return (
            <div key={item.id} className="mb-2.5 break-inside-avoid">
              <p className="break-words">
                {item.name}
                {included ? ' (termasuk paket)' : ''}
              </p>
              <Line
                left={`${trimZero(item.qty)}${item.unit ? ` ${item.unit}` : ''} x ${formatRupiah(item.unitPrice)}`}
                right={formatRupiah(item.lineTotal)}
              />
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
          <p>
            * Transfer ke Rek. ANDRIAS WARDOYO BCA 0501826391
          </p>
          <p>* Jangan memberi tip kepada petugas kami. Bayarlah sesuai jumlah di atas.</p>
          <p>* Suara Konsumen 082233889990.</p>
        </div>
        <Dash />
        <p className="text-center">TERIMA KASIH</p>
        <p className="text-center text-[11px]">Hormat kami, Ayub AC</p>
      </div>
    </div>
  );
}
