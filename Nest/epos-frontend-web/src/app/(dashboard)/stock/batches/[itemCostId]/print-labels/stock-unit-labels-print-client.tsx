'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { BarcodeQr } from '@/components/barcode-qr';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface StockUnitLabel {
  id: string;
  unitCode: string;
  qrToken: string;
}

// Padanan unit-labels-print-client.tsx (label unit AC customer), TAPI buat
// unit FISIK di GUDANG (Siklus QR per-unit, 2026-09-30) — dicetak abis
// Barang Masuk, atau dicetak ULANG dari sini kapan aja (misal buat stok lama
// yang di-backfill migration, belum pernah punya label fisik tertempel).
export function StockUnitLabelsPrintClient({
  itemCostId,
  initialUnitId,
}: {
  itemCostId: string;
  initialUnitId?: string;
}) {
  const router = useRouter();
  // Unit yang dipilih buat dicetak. null = belum diubah user: semua unit, atau
  // hanya unit dari ?unit= kalau halaman dibuka dari tombol "Cetak" satu unit.
  const [picked, setPicked] = React.useState<Set<string> | null>(null);
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

  const selected: Set<string> =
    picked ??
    (initialUnitId && data.some((u) => u.id === initialUnitId)
      ? new Set([initialUnitId])
      : new Set(data.map((u) => u.id)));
  const toPrint = data.filter((u) => selected.has(u.id));
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
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
        <Button onClick={() => window.print()} disabled={toPrint.length === 0}>
          <Printer className="size-4" />
          Cetak {toPrint.length > 1 ? `${toPrint.length} Label` : 'Label'}
        </Button>
      </div>

      {/* Pilih unit mana yang dicetak (tidak ikut tercetak). Bawaan: semua unit
          batch ini, kecuali dibuka dari tombol Cetak satu unit. */}
      {data.length > 1 && (
        <div className="mb-4 rounded-md border p-3 print:hidden">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Pilih unit yang dicetak ({toPrint.length} dari {data.length})
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPicked(new Set(data.map((u) => u.id)))}>
                Pilih semua
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPicked(new Set())}>
                Kosongkan
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((unit) => (
              <label key={unit.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={selected.has(unit.id)} onCheckedChange={() => toggle(unit.id)} />
                <span className="font-mono text-xs">{unit.unitCode}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white text-black">
        {toPrint.map((unit, i) => (
          <div
            key={unit.id}
            className="flex min-h-[44mm] flex-col items-center justify-center gap-1 text-center"
            style={i < toPrint.length - 1 ? { breakAfter: 'page' } : undefined}
          >
            <BarcodeQr value={unit.qrToken} size={64} />
            <p className="text-xs">{unit.unitCode}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
