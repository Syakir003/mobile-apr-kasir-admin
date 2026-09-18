'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { terbilangRupiah } from '@/lib/terbilang';
import { Button } from '@/components/ui/button';

// Padanan `Invoice`/`InvoiceItem` (invoice.dart) — Decimal Prisma lewat JSON
// selalu string, angka di-`Number(...)` pas dipakai.
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
  grandTotal: string;
  createdAt: string;
  items: InvoiceItem[];
  member: { address: string | null } | null;
}

// Minimal baris tabel item — nota fisik "AYUB AC" punya baris kosong kalau
// item digital kurang dari 10, meniru kertas nota yang emang segitu
// tinggi (lihat komentar sama di invoice_pdf.dart).
const MIN_ROWS = 10;

function formatDateDMY(value: string): string {
  const d = new Date(value);
  const two = (n: number) => n.toString().padStart(2, '0');
  return `${two(d.getDate())}-${two(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function trimZero(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : v;
}

export function InvoicePrintClient({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => apiClient.get<InvoiceDetail>(`/invoices/${invoiceId}`),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat invoice...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat invoice.</p>;

  const padCount = Math.max(0, MIN_ROWS - data.items.length);

  return (
    <div className="mx-auto max-w-[210mm]">
      {/* @page A4 khusus buat halaman ini — sidebar/header app disembunyikan
          lewat class `print:hidden` di DashboardShell. */}
      <style>{'@page { size: A4; margin: 12mm; }'}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" asChild>
          <Link href="/pos">
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak Invoice
        </Button>
      </div>

      <div className="bg-white p-2 text-black">
        {/* Header: kotak identitas toko | judul INVOICE | kotak NO/TGL/NAMA/ALAMAT/TLP */}
        <div className="flex items-start gap-3">
          <div className="flex-[5] border border-black p-2 text-center">
            <p className="text-sm font-bold">AYUB AC</p>
            <p className="mt-0.5 text-[8px] font-bold">
              Penjualan • Service • Spare Part • Rental AC
            </p>
            <p className="mt-1 text-[7px]">JL. GUNUNG ANYAR RT. 01 RW. 06</p>
            <p className="text-[7px]">KEL. GUNUNG GEDANGAN - MOJOKERTO</p>
            <p className="text-[7px]">TLP. : 0857 332 7112 - 0822 3388 9990</p>
            <p className="text-[7px]">0321 - 325831</p>
          </div>
          <div className="flex flex-[3] items-center justify-center">
            <p className="text-2xl font-bold">INVOICE</p>
          </div>
          <table className="flex-[6] border-collapse border border-black text-[8px]">
            <tbody>
              <tr>
                <td className="border border-black p-1 font-bold">NO.</td>
                <td className="border border-black p-1">{data.number}</td>
              </tr>
              <tr>
                <td className="border border-black p-1 font-bold">TGL.</td>
                <td className="border border-black p-1">{formatDateDMY(data.createdAt)}</td>
              </tr>
              <tr>
                <td className="border border-black p-1 font-bold">NAMA</td>
                <td className="border border-black p-1">{data.customerName ?? ''}</td>
              </tr>
              {/* ALAMAT dibuat lebih tinggi dari baris lain — samain kayak
                  nota fisik yang ngasih ruang 2 baris buat alamat panjang. */}
              <tr>
                <td className="border border-black p-1 py-2.5 font-bold">ALAMAT</td>
                <td className="border border-black p-1 py-2.5">{data.member?.address ?? ''}</td>
              </tr>
              <tr>
                <td className="border border-black p-1 font-bold">TLP.</td>
                <td className="border border-black p-1">{data.customerPhone ?? ''}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Tabel item */}
        <table className="mt-3 w-full border-collapse border border-black text-[8px]">
          <thead>
            {/* Nota fisik headernya polos putih (bukan abu2) — cuma bold. */}
            <tr>
              <th className="border border-black p-1">NO.</th>
              <th className="border border-black p-1">
                JUMLAH
                <br />
                BARANG
              </th>
              <th className="border border-black p-1">KETERANGAN</th>
              <th className="border border-black p-1">
                HARGA
                <br />
                SATUAN
              </th>
              <th className="border border-black p-1">JUMLAH</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={item.id}>
                <td className="border border-black p-1 text-center">{i + 1}</td>
                <td className="border border-black p-1 text-center">
                  {trimZero(item.qty)} {item.unit ?? ''}
                </td>
                <td className="border border-black p-1">{item.name}</td>
                <td className="border border-black p-1 text-right">
                  {formatRupiah(item.unitPrice)}
                </td>
                <td className="border border-black p-1 text-right">
                  {formatRupiah(item.lineTotal)}
                </td>
              </tr>
            ))}
            {Array.from({ length: padCount }).map((_, i) => (
              <tr key={`pad-${i}`}>
                <td className="border border-black p-1">&nbsp;</td>
                <td className="border border-black p-1">&nbsp;</td>
                <td className="border border-black p-1">&nbsp;</td>
                <td className="border border-black p-1">&nbsp;</td>
                <td className="border border-black p-1">&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Total */}
        <table className="w-full border-collapse border-x border-b border-black text-[8px]">
          <tbody>
            <tr>
              <td className="p-1 text-right font-bold">JUMLAH</td>
              <td className="w-32 border-l border-black p-1 text-right font-bold">
                {formatRupiah(data.grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* TERBILANG dikasih kotak — nota fisik nge-box baris ini persis
            kayak baris JUMLAH di atasnya, bukan cuma teks polos. */}
        <p className="border-x border-b border-black p-1 text-[9px]">
          TERBILANG : {terbilangRupiah(Number(data.grandTotal))}
        </p>

        {/* Catatan + tanda tangan — SATU kotak border nyambung (bukan 2 box
            kepisah kek sebelumnya), pembatas cuma garis tengah — samain
            kayak nota fisik. */}
        <div className="flex items-stretch border-x border-b border-black">
          <div className="flex-[7] p-2">
            <p className="text-[9px] font-bold">CATATAN :</p>
            <p className="mt-1 text-[7px]">
              * No. Laporan Pekerjaan : ..............................................
            </p>
            <p className="text-[7px]">
              * Barang yang sudah dibeli tidak dapat ditukar atau dikembalikan
            </p>
            <p className="text-[7px]">
              * Pembayaran dapat ditransfer ke Rek. ANDRIAS WARDOYO BCA 0501826391
            </p>
            <p className="text-[7px]">
              * Jangan memberi tip kepada petugas kami. Bayarlah sesuai jumlah diatas
            </p>
            <p className="text-[7px]">
              * Suara Konsumen 082233889990. Pastikan Anda dilayani dengan baik
            </p>
          </div>
          <div className="flex-[3] border-l border-black p-2 text-center">
            <p className="text-[9px] font-bold">HORMAT KAMI</p>
            <div className="h-10" />
          </div>
        </div>
      </div>
    </div>
  );
}
