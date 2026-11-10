'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelTitle } from '@/components/ui/panel';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Bagian bersama verifikasi setoran pembayaran lapangan (admin): dipakai tab "Setoran Teknisi" di Antrian Servis,
// panel setoran di halaman job, dan halaman laporan /setoran (Terima Pelunasan Selisih).

export interface HeldPayment {
  id: string;
  receiptNumber: string;
  amount: number;
  method: string;
  invoiceNumber: string;
  customerName: string | null;
  proofUrl: string | null;
  receiptChannel: string | null;
  source: string;
  createdAt: string;
  ageDays: number;
  orderId: string;
  jobId: string | null;
  jobStatus: string | null;
  unitLabel: string | null;
}
export interface PendingData {
  technician: { id: string; displayName: string };
  date: string;
  payments: HeldPayment[];
  expectedTotal: number;
  saldo: number;
  sparepartReturns: {
    requestId: string;
    customerName: string | null;
    items: { name: string; unit: string | null; approved: number; used: number; toReturn: number }[];
  }[];
}
export interface OutstandingItem {
  paymentId: string;
  receiptNumber: string;
  method: string;
  amount: number;
  status: string;
  proofUrl: string | null;
  source: string;
  createdAt: string;
  ageDays: number;
  orderId: string;
  jobId: string | null;
  jobStatus: string | null;
  unitCount: number;
  unitLabel: string | null;
  invoiceNumber: string;
  customerName: string | null;
  technician: { id: string; displayName: string };
}
export interface OutstandingData {
  items: OutstandingItem[];
  technicians: {
    technicianId: string;
    displayName: string;
    heldTotal: number;
    awaitingTotal: number;
    orderCount: number;
    paymentCount: number;
  }[];
}

export const errMsg = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export function useRefreshAll() {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    for (const k of ['settlements', 'field-payments', 'technician-jobs', 'invoices']) {
      queryClient.invalidateQueries({ queryKey: [k] });
    }
  }, [queryClient]);
}

/** Pembayaran lapangan yang belum terverifikasi (tunai dipegang + non-tunai menunggu dicocokkan), per teknisi & per order. */
export function useOutstanding(enabled = true) {
  return useQuery({
    queryKey: ['settlements', 'outstanding'],
    queryFn: () => apiClient.get<OutstandingData>('/settlements/outstanding'),
    enabled,
  });
}

/** Tautan ke halaman job dalam mode verifikasi setoran (panel Aksi berisi pencocokan, bukan aksi pekerjaan). */
export const setoranJobHref = (jobId: string) => `/teknisi/jobs/${jobId}?setoran=1`;

// Pilihan centang "diserahkan" per teknisi disimpan di sini supaya tidak hilang saat admin membuka job lalu kembali.
const uncheckedStore = new Map<string, Record<string, boolean>>();

export function SettlementForm({ data, variant = 'page' }: { data: PendingData; variant?: 'page' | 'panel' }) {
  const refresh = useRefreshAll();
  const techId = data.technician.id;
  const panel = variant === 'panel';
  const [unchecked, setUncheckedState] = React.useState<Record<string, boolean>>(() =>
    panel ? {} : { ...(uncheckedStore.get(techId) ?? {}) },
  );
  const setUnchecked = (next: Record<string, boolean>) => {
    if (!panel) uncheckedStore.set(techId, next);
    setUncheckedState(next);
  };
  const [received, setReceived] = React.useState<string | null>(null);
  const [handling, setHandling] = React.useState<'catat' | 'alasan' | null>(null);
  const [reason, setReason] = React.useState('');
  const [note, setNote] = React.useState('');
  const [sparepartNote, setSparepartNote] = React.useState('');
  const [repayOpen, setRepayOpen] = React.useState(false);

  const ticked = data.payments.filter((p) => !unchecked[p.id]);
  const expected = ticked.reduce((s, p) => s + p.amount, 0);
  const receivedValue = received ?? String(expected);
  const receivedNum = Number(receivedValue) || 0;
  const diff = receivedNum - expected;

  const mode = diff === 0 || !handling ? undefined : handling === 'alasan' ? 'selesai_dengan_alasan' : diff < 0 ? 'catat_kurang' : 'catat_lebih';
  const valid =
    ticked.length > 0 &&
    receivedValue !== '' &&
    (diff === 0 || (!!handling && (handling !== 'alasan' || reason.trim().length >= 10)));

  const settle = useMutation({
    mutationFn: () =>
      apiClient.post<{ expectedTotal: number; difference: number; saldo: number }>('/settlements', {
        technicianId: techId,
        paymentIds: ticked.map((p) => p.id),
        receivedTotal: receivedNum,
        ...(mode ? { mode } : {}),
        ...(mode === 'selesai_dengan_alasan' ? { reason: reason.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(sparepartNote.trim() ? { sparepartNote: sparepartNote.trim() } : {}),
      }),
    onSuccess: (r) => {
      toast.success(`Setoran diverifikasi (${formatRupiah(r.expectedTotal)}).`);
      uncheckedStore.delete(techId);
      setUncheckedState({});
      setReceived(null);
      setHandling(null);
      setReason('');
      setNote('');
      setSparepartNote('');
      refresh();
    },
    onError: (err) => toast.error(errMsg(err, 'Gagal memverifikasi setoran.')),
  });

  return (
    <div className="grid gap-4">
      {data.saldo !== 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <p>
            {data.saldo > 0 ? (
              <>
                Saldo kurang setor <span className="font-semibold">{formatRupiah(data.saldo)}</span> dari setoran sebelumnya.
              </>
            ) : (
              <>
                Kelebihan setor <span className="font-semibold">{formatRupiah(Math.abs(data.saldo))}</span> dari setoran sebelumnya.
              </>
            )}
          </p>
          {data.saldo > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setRepayOpen(true)}>
              Terima Pelunasan Selisih
            </Button>
          )}
        </div>
      )}

      {data.payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {data.technician.displayName} tidak memegang uang tunai yang belum disetor{panel ? ' untuk job ini' : ''}.
        </p>
      ) : (
        <>
          {panel ? (
            <ul className="grid gap-2">
              {data.payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs">{p.receiptNumber}</span>
                    <span className="block text-xs text-muted-foreground">{formatDateTime(p.createdAt)}</span>
                    {p.proofUrl && (
                      <a
                        href={`/api/proxy${p.proofUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        Lihat bukti
                      </a>
                    )}
                    {p.source === 'kertas' && <Badge variant="secondary" className="ml-1">kertas</Badge>}
                  </span>
                  <span className="shrink-0 font-medium">{formatRupiah(p.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <PanelTitle title={`Uang tunai dipegang ${data.technician.displayName}`} count={data.payments.length} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Pelanggan</TableHead>
                    <TableHead>Tanda Terima</TableHead>
                    <TableHead>Dicatat</TableHead>
                    <TableHead className="text-right">Nominal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Checkbox
                          checked={!unchecked[p.id]}
                          onCheckedChange={(c) => setUnchecked({ ...unchecked, [p.id]: c !== true })}
                          aria-label={`Diserahkan ${p.receiptNumber}`}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{p.customerName ?? '-'}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.invoiceNumber}
                          {p.unitLabel ? ` · ${p.unitLabel}` : ''}
                        </p>
                        {p.jobId && (
                          <Link href={setoranJobHref(p.jobId)} className="text-xs text-primary underline-offset-2 hover:underline">
                            Lihat pekerjaan
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <p className="font-mono">{p.receiptNumber}</p>
                        {p.proofUrl && (
                          <a
                            href={`/api/proxy${p.proofUrl}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            Lihat bukti
                          </a>
                        )}
                        {p.source === 'kertas' && <Badge variant="secondary" className="ml-1">kertas</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(p.createdAt)}
                        {p.ageDays >= 1 && <Badge variant="warning" className="ml-1">{p.ageDays} hari</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatRupiah(p.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className={cn('grid gap-3 rounded-xl border bg-card p-4 shadow-sm', !panel && 'max-w-xl')}>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Seharusnya disetor ({ticked.length} pembayaran)</span>
              <span className="text-lg font-semibold">{formatRupiah(expected)}</span>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`uang-diterima-${variant}`}>Uang yang diterima</Label>
              <CurrencyInput id={`uang-diterima-${variant}`} value={receivedValue} onChange={setReceived} />
            </div>

            {diff !== 0 && receivedValue !== '' && (
              <div className="grid gap-2 rounded-md border bg-muted/40 p-3">
                <p className={cn('text-sm font-medium', diff < 0 ? 'text-destructive' : 'text-status-warning-foreground dark:text-status-warning')}>
                  {diff < 0 ? 'Kurang' : 'Lebih'} {formatRupiah(Math.abs(diff))}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={handling === 'catat' ? 'default' : 'outline'}
                    onClick={() => setHandling('catat')}
                  >
                    {diff < 0 ? 'Catat kurang (jadi saldo teknisi)' : 'Catat lebih (mengurangi saldo)'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={handling === 'alasan' ? 'default' : 'outline'}
                    onClick={() => setHandling('alasan')}
                  >
                    Selesai dengan alasan
                  </Button>
                </div>
                {handling === 'alasan' && (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`alasan-selisih-${variant}`}>Alasan konkret (min. 10 karakter)</Label>
                    <Textarea
                      id={`alasan-selisih-${variant}`}
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Mis. dipakai beli freon, nota terlampir"
                    />
                    <p className="text-xs text-muted-foreground">
                      Selisih ditutup dan tidak menjadi saldo. Alasan ini tercatat dan dihitung di laporan Uang di Teknisi.
                    </p>
                  </div>
                )}
              </div>
            )}

            {data.sparepartReturns.length > 0 && (
              <div className="grid gap-2 rounded-md border p-3">
                <p className="text-sm font-medium">Cek sparepart yang harus kembali</p>
                {data.sparepartReturns.map((r) => (
                  <div key={r.requestId} className="text-sm">
                    <p className="text-xs text-muted-foreground">{r.customerName ?? 'Pelanggan'}</p>
                    <ul className="grid gap-0.5">
                      {r.items.map((it, i) => (
                        <li key={i} className="flex flex-wrap justify-between gap-2">
                          <span>{it.name}</span>
                          <span className={it.toReturn > 0 ? 'font-medium' : 'text-muted-foreground'}>
                            disetujui {it.approved}, terpakai {it.used}
                            {it.toReturn > 0 ? ` - kembali ${it.toReturn}${it.unit ? ` ${it.unit}` : ''}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <Textarea
                  rows={2}
                  value={sparepartNote}
                  onChange={(e) => setSparepartNote(e.target.value)}
                  placeholder="Catatan bila ada sparepart yang kurang (opsional)"
                  aria-label="Catatan sparepart"
                />
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor={`catatan-setoran-${variant}`}>Catatan setoran (opsional)</Label>
              <Input id={`catatan-setoran-${variant}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </div>

            <Button type="button" disabled={!valid || settle.isPending} onClick={() => settle.mutate()}>
              <Check className="size-4" />
              {settle.isPending ? 'Memverifikasi...' : 'Verifikasi Setoran'}
            </Button>
          </div>
        </>
      )}

      {repayOpen && (
        <RepayDialog technicianId={techId} saldo={data.saldo} open={repayOpen} onOpenChange={setRepayOpen} onDone={refresh} />
      )}
    </div>
  );
}

export function RepayDialog({
  technicianId,
  saldo,
  open,
  onOpenChange,
  onDone,
}: {
  technicianId: string;
  saldo: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  // Dialog hanya dipasang saat terbuka (lihat pemakainya), jadi isian selalu mulai dari nilai awal ini.
  const [amount, setAmount] = React.useState(saldo > 0 ? String(saldo) : '');
  const [note, setNote] = React.useState('');
  const value = Number(amount) || 0;
  const repay = useMutation({
    mutationFn: () => apiClient.post('/settlements/repay', { technicianId, amount: value, note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success('Pelunasan selisih dicatat.');
      onOpenChange(false);
      onDone();
    },
    onError: (err) => toast.error(errMsg(err, 'Gagal mencatat pelunasan.')),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Terima Pelunasan Selisih</DialogTitle>
          <DialogDescription>Saldo kurang setor saat ini {formatRupiah(saldo)}. Catat uang yang disetor belakangan.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="repay-amount">Jumlah</Label>
            <CurrencyInput id="repay-amount" value={amount} onChange={setAmount} />
            {value > saldo && <p className="text-xs text-destructive">Melebihi saldo kurang setor.</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="repay-note">Catatan (opsional)</Label>
            <Input id="repay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="button" disabled={value <= 0 || value > saldo || repay.isPending} onClick={() => repay.mutate()}>
            {repay.isPending ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
