'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PendingInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string | null;
  createdAt: string;
  pendingLines: number;
}

interface FulfillmentLine {
  refId: string;
  productName: string;
  qtyTotal: number;
  qtyFulfilled: number;
  qtyRemaining: number;
}

interface InvoiceFulfillment {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string | null;
  lines: FulfillmentLine[];
}

// Tahap KEDUA checkout (Siklus QR per-unit, 2026-09-30) — invoice udah
// terbit/dibayar di POS, halaman ini buat konfirmasi FISIK unit mana yang
// beneran keluar dari gudang (scan QR kamera atau ceklist manual). Biasanya
// dibuka dari device KEDUA (HP/tablet gudang), login akun yang sama/beda
// (JWT stateless, sesi ganda otomatis kesupport, gak butuh perubahan auth).
export function KasirScanClient() {
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

  const pendingQuery = useQuery({
    queryKey: ['kasir-scan', 'pending'],
    queryFn: () => apiClient.get<PendingInvoice[]>('/kasir-scan/pending'),
    enabled: !selectedInvoiceId,
  });

  const invoiceQuery = useQuery({
    queryKey: ['kasir-scan', 'invoice', selectedInvoiceId],
    queryFn: () => apiClient.get<InvoiceFulfillment>(`/kasir-scan/invoices/${selectedInvoiceId}`),
    enabled: !!selectedInvoiceId,
  });

  function refreshAfterFulfill() {
    void queryClient.invalidateQueries({ queryKey: ['kasir-scan', 'invoice', selectedInvoiceId] });
    void queryClient.invalidateQueries({ queryKey: ['kasir-scan', 'pending'] });
  }

  const scanMutation = useMutation({
    mutationFn: (qrToken: string) =>
      apiClient.post<{ swapped?: boolean; unitCode?: string; releasedUnitCode?: string }>('/kasir-scan/scan', {
        invoiceId: selectedInvoiceId,
        qrToken,
      }),
    onSuccess: (res) => {
      toast.success(
        res?.swapped
          ? `Unit ${res.unitCode ?? ''} ditandai keluar — menggantikan jatah ${res.releasedUnitCode ?? 'unit lain'} (balik ke stok)`
          : 'Unit berhasil ditandai keluar',
      );
      refreshAfterFulfill();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal memproses scan');
    },
  });

  const manualMutation = useMutation({
    mutationFn: (refId: string) =>
      apiClient.post('/kasir-scan/manual-fulfill', { invoiceId: selectedInvoiceId, refId }),
    onSuccess: () => {
      toast.success('Unit ditandai keluar (manual)');
      refreshAfterFulfill();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menandai manual');
    },
  });

  if (!selectedInvoiceId) {
    return (
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kasir Scan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Konfirmasi unit fisik yang beneran keluar dari gudang buat invoice yang udah checkout.
          </p>
        </div>
        {pendingQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
        {pendingQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Gak ada invoice yang masih nunggu fulfillment.</p>
        )}
        <div className="grid gap-3">
          {pendingQuery.data?.map((inv) => (
            <Card
              key={inv.invoiceId}
              className="cursor-pointer transition-colors hover:bg-accent"
              onClick={() => setSelectedInvoiceId(inv.invoiceId)}
            >
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{inv.invoiceNumber}</p>
                  <p className="text-sm text-muted-foreground">{inv.customerName ?? '-'}</p>
                </div>
                <p className="text-sm text-muted-foreground">{inv.pendingLines} baris belum keluar</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const data = invoiceQuery.data;
  const remainingLines = data?.lines.filter((l) => l.qtyRemaining > 0) ?? [];
  const allDone = !!data && remainingLines.length === 0;

  return (
    <div className="grid gap-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => setSelectedInvoiceId(null)}>
          <ArrowLeft className="size-4" />
          Kembali ke daftar
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{data?.invoiceNumber ?? '...'}</h1>
        <p className="text-sm text-muted-foreground">{data?.customerName ?? '-'}</p>
      </div>

      {allDone ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm">
            <CheckCircle2 className="size-5 text-green-600" />
            Semua unit di invoice ini udah keluar dari gudang.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan Unit</CardTitle>
          </CardHeader>
          <CardContent>
            <BarcodeScanner
              onDetect={(code) => scanMutation.mutate(code)}
              manualPlaceholder="Tempel/ketik QR token unit"
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {data?.lines.map((line) => (
          <Card key={line.refId}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{line.productName}</p>
                <p className="text-sm text-muted-foreground">
                  {line.qtyFulfilled}/{line.qtyTotal} unit udah keluar
                </p>
              </div>
              {line.qtyRemaining > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={manualMutation.isPending}
                  onClick={() => manualMutation.mutate(line.refId)}
                >
                  Ceklist Manual
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
