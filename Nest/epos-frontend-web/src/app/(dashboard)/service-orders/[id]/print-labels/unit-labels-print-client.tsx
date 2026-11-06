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
  // Teknisi (GET /technician-jobs/:id/unit-labels): alamat kerja per unit sudah disertakan di tiap baris.
  serviceOrderUnits: { id: string; unit: AcUnit; workAddress?: string | null }[];
  // Admin/kasir (GET /service-orders/:id): job per unit, memuat titik lokasi kerjanya (null = ikut alamat member).
  units?: { unitId: string | null; status: string; workAddress?: string | null }[];
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

  const rows = data.serviceOrderUnits.filter((su) => !onlyUnitIds || onlyUnitIds.includes(su.unit.id));
  const units = rows.map((su) => su.unit);
  // Alamat di label = titik lokasi kerja unit itu (satu member bisa punya AC di beberapa tempat); kosong = alamat member.
  const addressOf = (su: (typeof rows)[number]) =>
    su.workAddress ??
    data.units?.find((j) => j.unitId === su.unit.id && j.status !== 'dibatalkan')?.workAddress ??
    data.member?.address;
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
        {rows.map((su) => (
          <UnitLabelCard
            key={su.unit.id}
            unit={{
              barcodeValue: su.unit.barcodeValue,
              status: su.unit.status,
              brand: su.unit.brand,
              model: su.unit.model,
              pk: su.unit.pk,
              roomLocation: su.unit.roomLocation,
              indoorName: su.unit.indoorProduct?.name,
              outdoorName: su.unit.outdoorProduct?.name,
            }}
            memberName={data.member?.name}
            memberAddress={addressOf(su)}
          />
        ))}
      </div>
    </div>
  );
}
