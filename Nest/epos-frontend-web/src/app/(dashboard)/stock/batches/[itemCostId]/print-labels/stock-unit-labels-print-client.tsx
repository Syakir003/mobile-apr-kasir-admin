'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { BarcodeQr } from '@/components/barcode-qr';
import { Button } from '@/components/ui/button';

interface StockUnitLabel {
  id: string;
  unitCode: string;
  qrToken: string;
}

// Padanan unit-labels-print-client.tsx (label unit AC customer), TAPI buat
// unit FISIK di GUDANG (Siklus QR per-unit, 2026-09-30) — dicetak abis
// Barang Masuk, atau dicetak ULANG dari sini kapan aja (misal buat stok lama
// yang di-backfill migration, belum pernah punya label fisik tertempel).
export function StockUnitLabelsPrintClient({ itemCostId }: { itemCostId: string }) {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stock', 'batches', itemCostId, 'units'],
    queryFn: () => apiClient.get<StockUnitLabel[]>(`/stock/batches/${itemCostId}/units`),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat label unit...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat label unit.</p>;

  if (data.length === 0) {
    return (
      <div className="p-6">
        <Button variant="ghost" className="mb-4" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <p className="text-sm text-muted-foreground">Batch ini gak punya unit buat dicetak labelnya.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Lebih kecil dari label unit AC customer (105x148mm) — ini ditempel
          ke dus/unit di gudang, bukan dibawa teknisi, jadi 1 halaman muat
          beberapa label sekaligus. */}
      <style>{'@page { size: 70mm 50mm; margin: 3mm; }'}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak {data.length > 1 ? `${data.length} Label` : 'Label'}
        </Button>
      </div>

      <div className="bg-white text-black">
        {data.map((unit, i) => (
          <div
            key={unit.id}
            className="flex min-h-[44mm] flex-col items-center justify-center gap-1 text-center"
            style={i < data.length - 1 ? { breakAfter: 'page' } : undefined}
          >
            <BarcodeQr value={unit.qrToken} size={64} />
            <p className="text-xs">{unit.unitCode}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
