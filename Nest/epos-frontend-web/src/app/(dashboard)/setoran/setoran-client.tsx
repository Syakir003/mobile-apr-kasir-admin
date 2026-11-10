'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { methodLabel } from '../teknisi/jobs/[id]/payment-card';

// Setoran Teknisi (admin): mengubah pembayaran yang dicatat teknisi di lokasi menjadi pelunasan resmi.
//  - Setoran Tunai: cocokkan uang tunai yang diserahkan teknisi dengan catatan aplikasi (selisih dicatat).
//  - Cocokkan Mutasi: pembayaran non-tunai dicocokkan dengan mutasi rekening/QRIS toko.
//  - Uang di Teknisi: laporan uang yang masih dipegang, saldo kurang setor, dan selisih yang ditutup dengan alasan.

type TabValue = 'tunai' | 'mutasi' | 'laporan';

interface UserRow {
  id: string;
  displayName: string;
  role: string;
  active: boolean;
}
interface HeldPayment {
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
}
interface PendingData {
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
interface AwaitingData {
  items: {
    id: string;
    receiptNumber: string;
    method: string;
    amount: number;
    proofUrl: string | null;
    createdAt: string;
    invoiceNumber: string;
    customerName: string | null;
    technician: { id: string; displayName: string };
  }[];
  total: number;
}
interface CashRow {
  technicianId: string;
  displayName: string;
  heldTotal: number;
  heldCount: number;
  oldestHeldAgeDays: number | null;
  awaitingCount: number;
  saldo: number;
  closedWithReason30d: { count: number; total: number };
  excessCustomer: number;
}

const errMsg = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function useRefreshAll() {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    for (const k of ['settlements', 'field-payments', 'technician-jobs', 'invoices']) {
      queryClient.invalidateQueries({ queryKey: [k] });
    }
  }, [queryClient]);
}

export function SetoranClient({ initialTab, initialTechnicianId }: { initialTab: TabValue; initialTechnicianId: string }) {
  const [tab, setTab] = React.useState<TabValue>(initialTab);
  const awaitingQuery = useQuery({
    queryKey: ['settlements', 'awaiting'],
    queryFn: () => apiClient.get<AwaitingData>('/field-payments/awaiting'),
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Setoran Teknisi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cocokkan uang yang diterima teknisi di lokasi dengan catatan aplikasi. Pembayaran baru dianggap lunas setelah
          diverifikasi di sini.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="tunai">Setoran Tunai</TabsTrigger>
          <TabsTrigger value="mutasi">
            Cocokkan Mutasi
            {awaitingQuery.data && awaitingQuery.data.items.length > 0 && (
              <Badge variant="warning" className="ml-1.5">
                {awaitingQuery.data.items.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="laporan">Uang di Teknisi</TabsTrigger>
        </TabsList>
        <TabsContent value="tunai">
          <TunaiTab initialTechnicianId={initialTechnicianId} />
        </TabsContent>
        <TabsContent value="mutasi">
          <MutasiTab />
        </TabsContent>
        <TabsContent value="laporan">
          <LaporanTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Setoran tunai
// ---------------------------------------------------------------------------------------------------------------------

function TunaiTab({ initialTechnicianId }: { initialTechnicianId: string }) {
  const [technicianId, setTechnicianId] = React.useState(initialTechnicianId);
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => apiClient.get<UserRow[]>('/users') });
  const cashQuery = useQuery({
    queryKey: ['settlements', 'technician-cash'],
    queryFn: () => apiClient.get<CashRow[]>('/settlements/technician-cash'),
  });
  const technicians = (usersQuery.data ?? []).filter((u) => u.role === 'teknisi' && (u.active || u.id === technicianId));
  const heldOf = (id: string) => cashQuery.data?.find((c) => c.technicianId === id);

  const pendingQuery = useQuery({
    queryKey: ['settlements', 'pending', technicianId],
    queryFn: () => apiClient.get<PendingData>(`/settlements/pending?technicianId=${technicianId}`),
    enabled: !!technicianId,
  });

  return (
    <div className="grid gap-4">
      <div className="grid max-w-md gap-1.5">
        <Label>Teknisi</Label>
        <Select value={technicianId} onValueChange={setTechnicianId}>
          <SelectTrigger className="w-full" aria-label="Pilih teknisi">
            <SelectValue placeholder="Pilih teknisi yang menyetor" />
          </SelectTrigger>
          <SelectContent>
            {technicians.map((t) => {
              const h = heldOf(t.id);
              return (
                <SelectItem key={t.id} value={t.id}>
                  {t.displayName}
                  {h && h.heldTotal > 0 ? ` - dipegang ${formatRupiah(h.heldTotal)}` : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {!technicianId && <p className="text-sm text-muted-foreground">Pilih teknisi untuk melihat uang yang dipegangnya.</p>}
      {technicianId && pendingQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {technicianId && pendingQuery.isError && <p className="text-sm text-destructive">Gagal memuat data setoran.</p>}
      {pendingQuery.data && <SettlementForm key={technicianId} data={pendingQuery.data} />}
    </div>
  );
}

function SettlementForm({ data }: { data: PendingData }) {
  const refresh = useRefreshAll();
  const [unchecked, setUnchecked] = React.useState<Record<string, boolean>>({});
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
        technicianId: data.technician.id,
        paymentIds: ticked.map((p) => p.id),
        receivedTotal: receivedNum,
        ...(mode ? { mode } : {}),
        ...(mode === 'selesai_dengan_alasan' ? { reason: reason.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(sparepartNote.trim() ? { sparepartNote: sparepartNote.trim() } : {}),
      }),
    onSuccess: (r) => {
      toast.success(`Setoran diverifikasi (${formatRupiah(r.expectedTotal)}).`);
      setUnchecked({});
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
          {data.technician.displayName} tidak memegang uang tunai yang belum disetor.
        </p>
      ) : (
        <>
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
                        onCheckedChange={(c) => setUnchecked((u) => ({ ...u, [p.id]: c !== true }))}
                        aria-label={`Diserahkan ${p.receiptNumber}`}
                      />
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{p.customerName ?? '-'}</p>
                      <p className="text-xs text-muted-foreground">{p.invoiceNumber}</p>
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

          <div className="grid max-w-xl gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Seharusnya disetor ({ticked.length} pembayaran)</span>
              <span className="text-lg font-semibold">{formatRupiah(expected)}</span>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="uang-diterima">Uang yang diterima</Label>
              <CurrencyInput id="uang-diterima" value={receivedValue} onChange={setReceived} />
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
                    <Label htmlFor="alasan-selisih">Alasan konkret (min. 10 karakter)</Label>
                    <Textarea
                      id="alasan-selisih"
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
              <Label htmlFor="catatan-setoran">Catatan setoran (opsional)</Label>
              <Input id="catatan-setoran" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </div>

            <Button type="button" disabled={!valid || settle.isPending} onClick={() => settle.mutate()}>
              <Check className="size-4" />
              {settle.isPending ? 'Memverifikasi...' : 'Verifikasi Setoran'}
            </Button>
          </div>
        </>
      )}

      {repayOpen && (
        <RepayDialog
          technicianId={data.technician.id}
          saldo={data.saldo}
          open={repayOpen}
          onOpenChange={setRepayOpen}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function RepayDialog({
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
  // Dialog hanya dipasang saat terbuka (lihat SettlementForm), jadi isian selalu mulai dari nilai awal ini.
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

// ---------------------------------------------------------------------------------------------------------------------
// Cocokkan mutasi (non-tunai)
// ---------------------------------------------------------------------------------------------------------------------

function MutasiTab() {
  const refresh = useRefreshAll();
  const [rejectId, setRejectId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const query = useQuery({
    queryKey: ['settlements', 'awaiting'],
    queryFn: () => apiClient.get<AwaitingData>('/field-payments/awaiting'),
  });

  const verify = useMutation({
    mutationFn: (id: string) => apiClient.post(`/field-payments/${id}/verify`),
    onSuccess: () => {
      toast.success('Pembayaran dicocokkan dan dilunasi.');
      refresh();
    },
    onError: (err) => toast.error(errMsg(err, 'Gagal memverifikasi pembayaran.')),
  });
  const reject = useMutation({
    mutationFn: (id: string) => apiClient.post(`/field-payments/${id}/reject`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Pembayaran ditolak. Teknisi diberi tahu.');
      setRejectId(null);
      setReason('');
      refresh();
    },
    onError: (err) => toast.error(errMsg(err, 'Gagal menolak pembayaran.')),
  });

  const rows = query.data?.items ?? [];
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Buka m-banking atau dashboard QRIS toko, lalu cocokkan tiap pembayaran di bawah. Tekan Cocok bila transfernya
        ada; Tolak hanya bila tidak ditemukan (urus pelanggan dan teknisinya secara manual).
      </p>
      {query.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {query.isError && <p className="text-sm text-destructive">Gagal memuat pembayaran.</p>}
      {query.data && rows.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada pembayaran yang menunggu dicocokkan.</p>}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <PanelTitle title="Menunggu dicocokkan" count={rows.length} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pelanggan</TableHead>
                <TableHead>Metode</TableHead>
                <TableHead>Teknisi</TableHead>
                <TableHead>Dicatat</TableHead>
                <TableHead className="text-right">Nominal</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <p className="font-medium">{r.customerName ?? '-'}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.invoiceNumber} · {r.receiptNumber}
                    </p>
                  </TableCell>
                  <TableCell>
                    {methodLabel(r.method)}
                    {r.proofUrl && (
                      <a
                        href={`/api/proxy${r.proofUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-xs text-primary underline-offset-2 hover:underline"
                      >
                        Bukti
                      </a>
                    )}
                  </TableCell>
                  <TableCell>{r.technician.displayName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                  <TableCell className="text-right font-medium">{formatRupiah(r.amount)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <Button type="button" size="sm" disabled={verify.isPending} onClick={() => verify.mutate(r.id)}>
                        <Check className="size-4" />
                        Cocok
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRejectId(r.id)}
                      >
                        <X className="size-4" />
                        Tolak
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!rejectId} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak pembayaran</DialogTitle>
            <DialogDescription>
              Pembayaran tidak dilunasi dan teknisi diberi tahu. Tanda Terima yang sudah terkirim ke pelanggan perlu
              Anda urus secara manual.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="alasan-tolak">Alasan (min. 5 karakter)</Label>
            <Textarea
              id="alasan-tolak"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Mis. transfer tidak ada di mutasi"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectId(null)}>
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={reason.trim().length < 5 || reject.isPending}
              onClick={() => rejectId && reject.mutate(rejectId)}
            >
              {reject.isPending ? 'Menolak...' : 'Tolak Pembayaran'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Laporan Uang di Teknisi
// ---------------------------------------------------------------------------------------------------------------------

function LaporanTab() {
  const query = useQuery({
    queryKey: ['settlements', 'technician-cash'],
    queryFn: () => apiClient.get<CashRow[]>('/settlements/technician-cash'),
  });
  const rows = query.data ?? [];
  const excess = rows.reduce((s, r) => s + r.excessCustomer, 0);
  return (
    <div className="grid gap-4">
      {query.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {query.isError && <p className="text-sm text-destructive">Gagal memuat laporan.</p>}
      {excess > 0 && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <Badge variant="warning">Perlu dikembalikan ke pelanggan</Badge>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Total kelebihan bayar pelanggan {formatRupiah(excess)} (tagihan turun sesudah Tanda Terima terbit). Belum ada refund
            otomatis; kembalikan manual.
          </p>
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <PanelTitle title="Uang di Teknisi" count={rows.length} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teknisi</TableHead>
                <TableHead className="text-right">Dipegang</TableHead>
                <TableHead>Menunggu cocok</TableHead>
                <TableHead className="text-right">Saldo kurang setor</TableHead>
                <TableHead>Selisih ditutup alasan (30 hari)</TableHead>
                <TableHead className="text-right">Kelebihan pelanggan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.technicianId}>
                  <TableCell className="font-medium">
                    <Link href={`/setoran?technicianId=${r.technicianId}`} className="text-primary hover:underline">
                      {r.displayName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.heldCount > 0 ? (
                      <>
                        <span className="font-medium">{formatRupiah(r.heldTotal)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.heldCount} pembayaran
                          {r.oldestHeldAgeDays !== null && r.oldestHeldAgeDays >= 1 && (
                            <Badge variant="warning" className="ml-1">
                              tertua {r.oldestHeldAgeDays} hari
                            </Badge>
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{r.awaitingCount > 0 ? `${r.awaitingCount} pembayaran` : '-'}</TableCell>
                  <TableCell className={cn('text-right', r.saldo > 0 && 'font-medium text-destructive')}>
                    {r.saldo !== 0 ? formatRupiah(r.saldo) : '-'}
                  </TableCell>
                  <TableCell>
                    {r.closedWithReason30d.count > 0
                      ? `${r.closedWithReason30d.count}x, total ${formatRupiah(r.closedWithReason30d.total)}`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right">{r.excessCustomer > 0 ? formatRupiah(r.excessCustomer) : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
