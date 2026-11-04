'use client';

import { type UnitPartProduct } from '@/components/ac-unit-parts';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { UNIT_LABEL_SHEET_CLASS, UNIT_LABEL_SHEET_CSS, UnitLabelCard } from '@/components/unit-label-card';
import { Button } from '@/components/ui/button';

interface AcUnit {
  id: string;
  brand: string | null;
  model: string | null;
  pk?: number | null;
  roomLocation: string | null;
  barcodeValue: string;
  // 'menunggu_data' = unit "QR dulu" (tipe belum diketahui) — baris tipe di label dikosongkan (tanpa tulisan apa pun).
  status?: string;
  indoorProduct?: UnitPartProduct | null;
  outdoorProduct?: UnitPartProduct | null;
}
interface ServiceOrderDetail {
  id: string;
  // Member pembeli/pemilik unit — nama + alamatnya tercetak di tiap label, biar label yang sudah dicetak/tercecer bisa
  // langsung ketahuan punya siapa tanpa perlu scan dulu.
  member: { id: string; name: string; address?: string | null } | null;
  serviceOrderUnits: { id: string; unit: AcUnit }[];
}

export function UnitLabelsPrintClient({
  serviceOrderId,
  jobId,
  onlyUnitIds,
}: {
  // Admin/kasir: detail order (GET /service-orders/:id).
  serviceOrderId?: string;
  // Teknisi: GET /service-orders/:id 403, jadi datanya diambil lewat job miliknya (GET /technician-jobs/:id/unit-labels,
  // bentuk datanya sama, hanya unit yang job-nya milik teknisi itu).
  jobId?: string;
  // Hanya cetak unit-unit ini (servis banyak AC dengan sebagian unit yang sudah terlabel). Kosong = semua unit order.
  onlyUnitIds?: string[];
}) {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: jobId ? ['technician-jobs', jobId, 'unit-labels'] : ['service-orders', serviceOrderId],
    queryFn: () =>
      apiClient.get<ServiceOrderDetail>(
        jobId ? `/technician-jobs/${jobId}/unit-labels` : `/service-orders/${serviceOrderId}`,
      ),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat label unit...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat label unit.</p>;

  const units = data.serviceOrderUnits
    .map((su) => su.unit)
    .filter((u) => !onlyUnitIds || onlyUnitIds.includes(u.id));
  if (units.length === 0) {
    return (
      <div className="p-6">
        {/* router.back() (bukan Link href tetap ke /pos) — halaman ini
            sekarang dituju dari 2 alur beda (checkout POS & Servis Mandiri),
            balik ke asal masing-masing lebih make sense daripada dipukul
            rata ke satu tujuan. */}
        <Button variant="ghost" className="mb-4" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <p className="text-sm text-muted-foreground">
          Order ini tidak punya unit AC - tidak ada label yang bisa dicetak.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Stiker yang sama dengan cetak label Input Data Lampau (UnitLabelCard): lembar A4 2 kolom, satu stiker per
          unit, gampang dipotong & ditempel ke unit AC member-nya. */}
      <style>{UNIT_LABEL_SHEET_CSS}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak {units.length > 1 ? `${units.length} Label` : 'Label'}
        </Button>
      </div>

      <div className={UNIT_LABEL_SHEET_CLASS}>
        {units.map((unit) => (
          <UnitLabelCard
            key={unit.id}
            unit={{
              barcodeValue: unit.barcodeValue,
              status: unit.status,
              brand: unit.brand,
              model: unit.model,
              pk: unit.pk,
              roomLocation: unit.roomLocation,
              indoorName: unit.indoorProduct?.name,
              outdoorName: unit.outdoorProduct?.name,
            }}
            memberName={data.member?.name}
            memberAddress={data.member?.address}
          />
        ))}
      </div>
    </div>
  );
}
