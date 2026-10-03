'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, PackageSearch, ScanLine } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PendingInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string | null;
  createdAt: string;
  pendingLines: number;
  pendingUnits: number;
}

interface FulfillmentLine {
  refId: string;
  productName: string;
  acRole: 'indoor' | 'outdoor' | null;
  pairName: string | null;
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

interface FulfillResult {
  unitCode?: string;
  productName?: string | null;
  acRole?: 'indoor' | 'outdoor' | null;
  swapped?: boolean;
  releasedUnitCode?: string;
}

// Hasil scan terakhir — tetap tampil di layar (toast cepat hilang, gudang
// sering menoleh ke rak dulu) sampai scan berikutnya.
type LastScan = { ok: true; text: string; sub?: string } | { ok: false; text: string };

// Tahap KEDUA checkout (Siklus QR per-unit): kasir cuma checkout (unit
// "dijatah"/reserved); GUDANG yang mengambil unit dari rak dan menscan
// QR-nya di sini. Baru saat discan unit resmi KELUAR dan stok berkurang.
export function KasirScanClient() {
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState<string | null>(null);
  const [lastScan, setLastScan] = React.useState<LastScan | null>(null);
  const [manualLine, setManualLine] = React.useState<FulfillmentLine | null>(null);
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
    mutationFn: (code: string) =>
      apiClient.post<FulfillResult>('/kasir-scan/scan', { invoiceId: selectedInvoiceId, qrToken: code }),
    onSuccess: (res) => {
      setLastScan({
        ok: true,
        text: `${res?.unitCode ?? 'Unit'}${res?.productName ? ` · ${res.productName}` : ''}${roleSuffix(res?.acRole)} sudah keluar`,
        sub: res?.swapped
          ? `Menggantikan jatah ${res.releasedUnitCode ?? 'unit lain'}, yang dikembalikan ke stok.`
          : undefined,
      });
      refreshAfterFulfill();
    },
    onError: (err) => {
      setLastScan({ ok: false, text: err instanceof ApiError ? err.message : 'Gagal memproses scan' });
    },
  });

  const manualMutation = useMutation({
    mutationFn: (refId: string) =>
      apiClient.post<FulfillResult>('/kasir-scan/manual-fulfill', { invoiceId: selectedInvoiceId, refId }),
    onSuccess: (res) => {
      setLastScan({
        ok: true,
        text: `${res?.unitCode ?? 'Unit'}${res?.productName ? ` · ${res.productName}` : ''}${roleSuffix(res?.acRole)} ditandai keluar (manual)`,
      });
      setManualLine(null);
      refreshAfterFulfill();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menandai manual');
      setManualLine(null);
    },
  });

  if (!selectedInvoiceId) {
    return (
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Keluar Gudang</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Konfirmasi unit AC yang benar-benar keluar dari gudang untuk invoice yang sudah checkout.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alurnya</CardTitle>
            <CardDescription>
              Unit yang sudah di-checkout kasir baru dijatah. Stok resmi berkurang setelah unitnya discan di sini.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Step icon={<ClipboardCheck className="size-5" />} title="1. Kasir checkout">
              Invoice terbit dan unit dijatah. Muncul di daftar di bawah.
            </Step>
            <Step icon={<PackageSearch className="size-5" />} title="2. Ambil unit dari rak">
              Ambil unit sesuai produk di invoice. Boleh unit mana saja yang setipe.
            </Step>
            <Step icon={<ScanLine className="size-5" />} title="3. Scan QR di label">
              Pilih invoice, scan QR di kardus unit. Unit ditandai keluar.
            </Step>
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-3 text-base font-semibold">Menunggu dikeluarkan</h2>
          {pendingQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {pendingQuery.data?.length === 0 && (
            <Card>
              <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <CheckCircle2 className="size-5 text-green-600" />
                Tidak ada unit yang menunggu. Semua invoice sudah selesai dikeluarkan.
              </CardContent>
            </Card>
          )}
          <div className="grid gap-3">
            {pendingQuery.data?.map((inv) => (
              <Card
                key={inv.invoiceId}
                className="cursor-pointer transition-colors hover:bg-accent"
                onClick={() => {
                  setLastScan(null);
                  setSelectedInvoiceId(inv.invoiceId);
                }}
              >
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div>
                    <p className="font-medium">{inv.invoiceNumber}</p>
                    <p className="text-sm text-muted-foreground">
                      {inv.customerName ?? '-'} · {formatDate(inv.createdAt)}
                    </p>
                  </div>
                  <Badge variant="secondary">{inv.pendingUnits} unit belum keluar</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const data = invoiceQuery.data;
  const totalUnits = data?.lines.reduce((a, l) => a + l.qtyTotal, 0) ?? 0;
  const doneUnits = data?.lines.reduce((a, l) => a + l.qtyFulfilled, 0) ?? 0;
  const allDone = !!data && totalUnits > 0 && doneUnits === totalUnits;

  return (
    <div className="grid gap-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => setSelectedInvoiceId(null)}>
          <ArrowLeft className="size-4" />
          Kembali ke daftar
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{data?.invoiceNumber ?? '...'}</h1>
        <p className="text-sm text-muted-foreground">{data?.customerName ?? '-'}</p>
        {data && (
          <div className="mt-3 max-w-sm">
            <p className="text-sm font-medium">
              {doneUnits} dari {totalUnits} unit sudah keluar
            </p>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-green-600 transition-all"
                style={{ width: `${totalUnits ? (doneUnits / totalUnits) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {allDone ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm">
            <CheckCircle2 className="size-5 text-green-600" />
            Semua unit di invoice ini sudah keluar dari gudang.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan unit</CardTitle>
            <CardDescription>
              Arahkan kamera ke QR di label unit, atau ketik kode label (contoh PRD-0001-U0007).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <BarcodeScanner
              onDetect={(code) => scanMutation.mutate(code)}
              manualPlaceholder="Ketik kode label, mis. PRD-0001-U0007"
            />
          </CardContent>
        </Card>
      )}

      {lastScan && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
            lastScan.ok
              ? 'border-green-600/40 bg-green-600/10 text-green-800 dark:text-green-300'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          }`}
        >
          {lastScan.ok ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          )}
          <div>
            <p className="font-medium">{lastScan.text}</p>
            {lastScan.ok && lastScan.sub && <p className="mt-0.5 text-xs opacity-80">{lastScan.sub}</p>}
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {data?.lines.map((line) => (
          <Card key={line.refId}>
            <CardContent className="flex items-center justify-between gap-3 py-4">
              <div>
                <p className="font-medium">
                  {line.productName}
                  {line.acRole && (
                    <Badge variant={line.acRole === 'indoor' ? 'default' : 'secondary'} className="ml-2 align-middle">
                      {line.acRole === 'indoor' ? 'Indoor' : 'Outdoor'}
                    </Badge>
                  )}
                </p>
                {line.pairName && (
                  <p className="text-xs text-muted-foreground">
                    Satu paket. Pasangan {line.acRole === 'indoor' ? 'Outdoor' : 'Indoor'}: {line.pairName}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {line.qtyFulfilled} dari {line.qtyTotal} unit sudah keluar
                </p>
              </div>
              {line.qtyRemaining > 0 ? (
                <Button variant="outline" size="sm" onClick={() => setManualLine(line)}>
                  Tandai manual
                </Button>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="size-3.5 text-green-600" />
                  Selesai
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!manualLine} onOpenChange={(open) => !open && setManualLine(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tandai 1 unit keluar tanpa scan?</DialogTitle>
            <DialogDescription>
              {manualLine?.productName}. Sistem mengambil 1 unit yang dijatah paling lama. Gunakan hanya kalau QR
              rusak atau tidak terbaca.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualLine(null)}>
              Batal
            </Button>
            <Button
              disabled={manualMutation.isPending}
              onClick={() => manualLine && manualMutation.mutate(manualLine.refId)}
            >
              Tandai keluar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function roleSuffix(role?: 'indoor' | 'outdoor' | null): string {
  return role === 'indoor' ? ' (Indoor)' : role === 'outdoor' ? ' (Outdoor)' : '';
}

function Step({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
