'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Usb } from 'lucide-react';
import { toast } from 'sonner';

import { apiClient } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { buildReceiptBytes, printToSerial } from '@/lib/escpos';
import { Button } from '@/components/ui/button';
import { ReceiptView, formatDateTime, summarize, trimZero, type ReceiptData } from '@/components/receipt-view';

type InvoiceDetail = Omit<ReceiptData, 'address'> & { member: { address: string | null } | null };

// Struk kasir (printer thermal 58mm, area cetak ~48mm). Dulu halaman ini replika formulir invoice A4 bercetak.
export function InvoicePrintClient({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => apiClient.get<InvoiceDetail>(`/invoices/${invoiceId}`),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat struk...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat struk.</p>;

  const receipt: ReceiptData = { ...data, address: data.member?.address };

  // Cetak langsung ke printer thermal (ESC/POS lewat Web Serial), tanpa dialog cetak/driver Windows.
  async function printThermal() {
    const { grand, paid, sisa, extras } = summarize(receipt);
    try {
      const bytes = buildReceiptBytes({
        header: [
          'Penjualan - Service - Spare Part - Rental AC',
          'JL. GUNUNG ANYAR RT. 01 RW. 06',
          'KEL. GUNUNG GEDANGAN - MOJOKERTO',
          'Telp. 0857 332 7112 - 0822 3388 9990',
          '0321 - 325831',
        ],
        meta: [
          ['No', receipt.number],
          ['Tanggal', formatDateTime(receipt.createdAt)],
          ...(receipt.customerName ? [['Pelanggan', receipt.customerName] as [string, string]] : []),
          ...(receipt.customerPhone ? [['Telp', receipt.customerPhone] as [string, string]] : []),
        ],
        alamat: receipt.address ?? undefined,
        items: receipt.items.map((item) => ({
          name: `${item.name}${item.kind === 'product' && Number(item.lineTotal) === 0 ? ' (termasuk paket)' : ''}`,
          qty: `${trimZero(item.qty)}${item.unit ? ` ${item.unit}` : ''} x ${formatRupiah(item.unitPrice)}`,
          total: formatRupiah(item.lineTotal),
        })),
        extras: extras.map((e) => [e.label, e.value]),
        total: formatRupiah(grand),
        lunas: receipt.status === 'lunas',
        pembayaran:
          paid > 0
            ? [
                [receipt.status === 'dp' ? 'DP' : 'Dibayar', formatRupiah(paid)],
                ['SISA TAGIHAN', formatRupiah(sisa)],
              ]
            : [],
        notes: receipt.notes ?? undefined,
        footer: [
          '* Barang yang sudah dibeli tidak dapat ditukar atau dikembalikan.',
          '* Transfer ke Rek. ANDRIAS WARDOYO BCA 0501826391',
          '* Jangan memberi tip kepada petugas kami.',
          '* Suara Konsumen 082233889990.',
          'TERIMA KASIH',
        ],
      });
      await printToSerial(bytes);
      toast.success('Struk dikirim ke printer.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') return; // dialog pilih port dibatalkan
      toast.error(err instanceof Error ? err.message : 'Gagal mencetak ke printer thermal.');
    }
  }

  return (
    <div className="mx-auto max-w-full">
      {/* Kertas thermal 58mm (area cetak ~48mm, margin kiri-kanan 5mm), tinggi mengikuti isi. Untuk printer 80mm: lebar 72mm, margin 3mm. */}
      <style>{'@page { size: 58mm auto; margin: 3mm 5mm; } @media print { body { background: #fff; } .struk-sheet { zoom: 1 !important; } }'}</style>

      <div className="mx-auto mb-4 flex max-w-md flex-wrap items-center justify-between gap-2 print:hidden">
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
        <Button variant="outline" onClick={printThermal}>
          <Usb className="size-4" />
          Cetak ke Thermal
        </Button>
      </div>

      {/* Di layar diperbesar 1.5x supaya terbaca; saat cetak kembali ke ukuran asli 48mm. */}
      <ReceiptView data={receipt} />
    </div>
  );
}
