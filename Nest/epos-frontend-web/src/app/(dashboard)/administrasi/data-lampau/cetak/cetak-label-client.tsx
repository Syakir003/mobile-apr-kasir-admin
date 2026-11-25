'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { UNIT_LABEL_SHEET_CLASS, UNIT_LABEL_SHEET_CSS, UnitLabelCard } from '@/components/unit-label-card';
import { Button } from '@/components/ui/button';
import { ErrorBlock, LoadingBlock } from '@/components/query-state';

interface LabelUnit {
  id: string;
  barcodeValue: string;
  status: string;
  brand: string | null;
  model: string | null;
  pk: number | null;
  roomLocation: string | null;
  // Member multi lokasi: nama lokasi unit + alamat lokasinya (job aktif, atau alamat lokasi unit). null = member biasa.
  locationName?: string | null;
  workAddress?: string | null;
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
  if (isLoading) return <LoadingBlock label="Memuat label" className="p-6" />;
  if (isError || !data) return <ErrorBlock title="Gagal memuat label" detail="Periksa koneksi internet, lalu muat ulang halaman." className="p-6" />;

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
              locationName: u.locationName,
              indoorName: u.indoorProduct?.name,
              outdoorName: u.outdoorProduct?.name,
            }}
            memberName={u.member.name}
            // Member multi lokasi: alamat lokasi unit itu (bukan selalu alamat utama); member biasa tetap alamat member.
            memberAddress={(u.locationName ? u.workAddress : null) || u.member.address || '-'}
          />
        ))}
      </div>
    </div>
  );
}
