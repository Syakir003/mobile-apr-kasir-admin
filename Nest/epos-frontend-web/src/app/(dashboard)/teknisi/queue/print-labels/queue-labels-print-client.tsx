'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  LabelSheetSettings,
  UnitLabelSheet,
  useLabelSheetSettings,
  type SheetItem,
} from '@/components/unit-label-sheet';

// Bentuk data sama dengan cetak label Input Data Lampau (GET /unit-labels/data).
interface LabelUnit {
  id: string;
  barcodeValue: string;
  status: string;
  brand: string | null;
  model: string | null;
  pk: number | null;
  roomLocation: string | null;
  indoorProduct?: { name: string } | null;
  outdoorProduct?: { name: string } | null;
  member: { id: string; name: string; phone: string | null; address: string | null };
  // Titik lokasi kerja dari job unit ini yang sedang berjalan (null = ikut alamat member).
  workAddress?: string | null;
}

// Cetak QR unit AC dari beberapa job sekaligus (dipilih di daftar Job Teknisi), dengan pilihan kertas dan jumlah
// kolom. Stikernya sama dengan label Input Data Lampau / job teknisi (UnitLabelCard).
export function QueueLabelsPrintClient({ ids }: { ids: string }) {
  const router = useRouter();
  const settings = useLabelSheetSettings();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['unit-labels', 'data', ids],
    queryFn: () => apiClient.get<LabelUnit[]>(`/unit-labels/data?ids=${encodeURIComponent(ids)}`),
    enabled: !!ids,
  });
  // Sama dengan cetak label Data Lampau: label yang sudah dicetak ditandai, supaya tab Label di Input Data Lampau
  // tidak lagi menyebutnya "belum dicetak".
  const markPrinted = useMutation({
    mutationFn: (list: string[]) => apiClient.post('/unit-labels/mark-printed', { ids: list }),
  });

  if (!ids) return <p className="p-6 text-sm text-muted-foreground">Tidak ada unit yang dipilih.</p>;
  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat label...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat label.</p>;

  const items: SheetItem[] = data.map((u) => ({
    key: u.id,
    unit: {
      barcodeValue: u.barcodeValue,
      status: u.status,
      brand: u.brand,
      model: u.model,
      pk: u.pk,
      roomLocation: u.roomLocation,
      indoorName: u.indoorProduct?.name,
      outdoorName: u.outdoorProduct?.name,
    },
    memberName: u.member.name,
    memberAddress: u.workAddress || u.member.address || '-',
  }));

  function handlePrint() {
    window.print();
    markPrinted.mutate(data!.map((u) => u.id));
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <Button onClick={handlePrint} disabled={items.length === 0}>
          <Printer className="size-4" />
          Cetak {items.length} Label
        </Button>
      </div>

      <LabelSheetSettings
        paper={settings.paper}
        cols={settings.cols}
        onPaper={settings.setPaper}
        onCols={settings.setCols}
        total={items.length}
      />
      <UnitLabelSheet items={items} paper={settings.paper} cols={settings.cols} />
    </div>
  );
}
