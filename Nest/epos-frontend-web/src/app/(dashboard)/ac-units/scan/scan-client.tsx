'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiClient, ApiError } from '@/lib/api-client';
import { AcUnitDetailView, type AcUnitDetail } from '@/components/ac-unit-detail-view';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Padanan scan_screen.dart di app mobile (kamera in-app -> findByBarcode ->
// bottom sheet detail unit) — sekarang web JUGA punya akses kamera beneran
// (lewat BarcodeScanner, real-time via getUserMedia), plus 2 mode lain:
// input manual (juga tetap kepake buat scanner fisik/barcode-gun yang
// nyuntik teks+Enter) & upload foto yang udah ada buat dipindai di situ.
//
// Manggil GET /ac-units/lookup/:barcodeValue (AcUnitsService.lookupByBarcode)
// — endpoint ini udah lama ada & udah dijamin JWT+role guard di backend,
// cuma belum pernah dipanggil dari frontend web sampai sekarang.
export function ScanUnitClient() {
  const [barcode, setBarcode] = React.useState<string | null>(null);
  // Ikut nempel di queryKey biar submit ulang barcode YANG SAMA (mis. abis
  // status unit itu berubah gara-gara job kelar) tetap narik data baru,
  // bukan cuma balikin cache lama — TanStack Query gak refetch otomatis
  // cuma karena state di-set ulang ke nilai yang identik.
  const [submitCount, setSubmitCount] = React.useState(0);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['ac-units', 'lookup', barcode, submitCount],
    queryFn: () =>
      apiClient.get<AcUnitDetail>(`/ac-units/lookup/${encodeURIComponent(barcode!)}`),
    enabled: !!barcode,
    retry: false,
  });

  function handleDetect(code: string) {
    setBarcode(code);
    setSubmitCount((n) => n + 1);
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scan Unit AC</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan atau ketik barcode yang ditempel di unit buat langsung lihat data pelanggan &amp;
          riwayat servisnya.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Barcode Unit</CardTitle>
        </CardHeader>
        <CardContent>
          <BarcodeScanner
            onDetect={handleDetect}
            manualPlaceholder="Contoh: ACUNIT-20260828-0001"
          />
          {isFetching && <p className="mt-3 text-sm text-muted-foreground">Mencari unit...</p>}
        </CardContent>
      </Card>

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Gagal mencari unit.'}
        </p>
      )}

      {!isFetching && !isError && data && <AcUnitDetailView data={data} />}
    </div>
  );
}
