'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { UNIT_LABEL_SHEET_CLASS, UNIT_LABEL_SHEET_CSS, UnitLabelCard } from '@/components/unit-label-card';
import { Button } from '@/components/ui/button';

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
}

// Lembar stiker A4, 2 kolom (tampilan stiker sama dengan cetak label di job teknisi: lihat UnitLabelCard). Unit
// 'menunggu_data' (tipe belum diketahui) tidak diberi tulisan apa pun di baris tipe, dibiarkan kosong — teknisi
// melengkapi datanya saat scan di lokasi.
export function CetakLabelClient({ ids }: { ids: string }) {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['unit-labels', 'data', ids],
    queryFn: () => apiClient.get<LabelUnit[]>(`/unit-labels/data?ids=${encodeURIComponent(ids)}`),
    enabled: !!ids,
  });
  const markPrinted = useMutation({
    mutationFn: (list: string[]) => apiClient.post('/unit-labels/mark-printed', { ids: list }),
  });

  if (!ids) return <p className="p-6 text-sm text-muted-foreground">Tidak ada unit yang dipilih.</p>;
  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat label...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat label.</p>;

  function handlePrint() {
    window.print();
    markPrinted.mutate(data!.map((u) => u.id));
  }

  return (
    <div>
      <style>{UNIT_LABEL_SHEET_CSS}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <Button onClick={handlePrint}>
          <Printer className="size-4" />
          Cetak {data.length} Label
        </Button>
      </div>

      <div className={UNIT_LABEL_SHEET_CLASS}>
        {data.map((u) => (
          <UnitLabelCard
            key={u.id}
            unit={{
              barcodeValue: u.barcodeValue,
              status: u.status,
              brand: u.brand,
              model: u.model,
              pk: u.pk,
              roomLocation: u.roomLocation,
              indoorName: u.indoorProduct?.name,
              outdoorName: u.outdoorProduct?.name,
            }}
            memberName={u.member.name}
            memberAddress={u.member.address || '-'}
          />
        ))}
      </div>
    </div>
  );
}
