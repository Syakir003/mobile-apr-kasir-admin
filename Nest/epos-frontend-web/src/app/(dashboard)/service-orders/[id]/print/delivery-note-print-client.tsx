'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

interface InvoiceItem {
  id: string;
  kind: string;
  name: string;
  unit: string | null;
  qty: string;
}
interface ServiceOrderDetail {
  id: string;
  member: { name: string; phone: string | null } | null;
  invoice: {
    id: string;
    number: string;
    customerName: string | null;
    customerPhone: string | null;
    items: InvoiceItem[];
  } | null;
}

// Minimal baris tabel — padanan `(6 - barang.length).clamp(0, 6)` di
// delivery_note_pdf.dart.
const MIN_ROWS = 6;

function trimZero(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : v;
}

export function DeliveryNotePrintClient({ serviceOrderId }: { serviceOrderId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['service-orders', serviceOrderId],
    queryFn: () => apiClient.get<ServiceOrderDetail>(`/service-orders/${serviceOrderId}`),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat surat jalan...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat surat jalan.</p>;

  if (!data.invoice) {
    return (
      <div className="p-6">
        <Button variant="ghost" asChild className="mb-4">
          <Link href="/pos">
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          Order ini tidak punya invoice terkait (bukan dari transaksi POS) — surat jalan cuma
          berlaku untuk pengiriman barang hasil pembelian, jadi tidak ada yang bisa dicetak.
        </p>
      </div>
    );
  }

  // Jasa (mis. ongkos pemasangan) sengaja dikecualikan — jasa gak
  // "dikirim", persis pola delivery_note_pdf.dart.
  const barang = data.invoice.items.filter((i) => i.kind !== 'service');
  const custName = data.invoice.customerName ?? data.member?.name ?? '';
  const custPhone = data.invoice.customerPhone ?? data.member?.phone ?? '';

  return (
    <div className="mx-auto max-w-[210mm]">
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
          Cetak Surat Jalan
        </Button>
      </div>

      {/* Dua salinan identik dalam satu halaman (pengirim & penerima),
          dipotong di rumah — persis delivery_note_pdf.dart. */}
      <div className="bg-white p-2 text-black">
        <Half number={data.invoice.number} custName={custName} custPhone={custPhone} barang={barang} />
        <div className="my-4 border-t border-dashed border-black" />
        <Half number={data.invoice.number} custName={custName} custPhone={custPhone} barang={barang} />
      </div>
    </div>
  );
}

function Half({
  number,
  custName,
  custPhone,
  barang,
}: {
  number: string;
  custName: string;
  custPhone: string;
  barang: InvoiceItem[];
}) {
  const padCount = Math.max(0, MIN_ROWS - barang.length);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="text-left">
          <p className="text-sm font-bold">CV. AYUB PODO RUKUN</p>
          <p className="text-[7px] font-bold">Penjualan • Service • Spare Part • Rental AC</p>
          <p className="text-[7px]">JL. GUNUNG ANYAR RT. 01 RW. 06</p>
          <p className="text-[7px]">KEL. GUNUNG GEDANGAN - MOJOKERTO</p>
          <p className="text-[7px]">TLP. : 0857 332 7112 - 0822 3388 9990</p>
          <p className="text-[7px]">FAX. : (0321) 325831</p>
        </div>
        <div className="text-right text-[8px]">
          <p>Kepada Yth. :</p>
          <p className="text-[9px]">{custName}</p>
          {custPhone && <p>{custPhone}</p>}
        </div>
      </div>

      <p className="mt-2 text-sm font-bold">SURAT JALAN : No. {number}</p>

      <table className="mt-1 w-full border-collapse border border-black text-[8px]">
        <thead>
          <tr className="bg-gray-200">
            <th className="w-8 border border-black p-1">NO.</th>
            <th className="w-20 border border-black p-1">BANYAKNYA</th>
            <th className="border border-black p-1">NAMA BARANG</th>
          </tr>
        </thead>
        <tbody>
          {barang.map((item, i) => (
            <tr key={item.id}>
              <td className="border border-black p-1 text-center">{i + 1}</td>
              <td className="border border-black p-1 text-center">
                {trimZero(item.qty)} {item.unit ?? ''}
              </td>
              <td className="border border-black p-1">{item.name}</td>
            </tr>
          ))}
          {Array.from({ length: padCount }).map((_, i) => (
            <tr key={`pad-${i}`}>
              <td className="border border-black p-1">&nbsp;</td>
              <td className="border border-black p-1">&nbsp;</td>
              <td className="border border-black p-1">&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex justify-around text-center text-[9px]">
        <div>
          <p>Tanda Terima,</p>
          <div className="h-8" />
          <p>...................................</p>
        </div>
        <div>
          <p>Hormat Kami,</p>
          <div className="h-8" />
          <p>...................................</p>
        </div>
      </div>
    </div>
  );
}
