'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { Barcode128 } from '@/components/barcode-128';
import { Button } from '@/components/ui/button';

interface AcUnit {
  id: string;
  brand: string | null;
  model: string | null;
  roomLocation: string | null;
  barcodeValue: string;
}
interface ServiceOrderDetail {
  id: string;
  serviceOrderUnits: { id: string; unit: AcUnit }[];
}

export function UnitLabelsPrintClient({ serviceOrderId }: { serviceOrderId: string }) {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['service-orders', serviceOrderId],
    queryFn: () => apiClient.get<ServiceOrderDetail>(`/service-orders/${serviceOrderId}`),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat label unit...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat label unit.</p>;

  const units = data.serviceOrderUnits.map((su) => su.unit);
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
          Order ini tidak punya unit AC — tidak ada label yang bisa dicetak.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* A6 per label (padanan unit_label_pdf.dart) — tiap unit dapet
          halaman sendiri (`break-after: page`) biar gampang dipotong &
          ditempel satu-satu ke unit AC-nya masing-masing. */}
      <style>{'@page { size: 105mm 148mm; margin: 6mm; }'}</style>

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

      <div className="bg-white text-black">
        {units.map((unit, i) => (
          <div
            key={unit.id}
            className="flex min-h-[136mm] flex-col items-center justify-center gap-2 text-center"
            style={i < units.length - 1 ? { breakAfter: 'page' } : undefined}
          >
            <p className="text-base font-bold">Ayub Podo Rukun</p>
            <Barcode128 value={unit.barcodeValue} moduleWidth={1.6} height={64} />
            <p className="text-sm">{unit.barcodeValue}</p>
            <p className="text-sm">
              {[unit.brand, unit.model].filter(Boolean).join(' ') || '-'}
            </p>
            {unit.roomLocation && <p className="text-sm">{unit.roomLocation}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
