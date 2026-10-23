'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Plus, Send, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDateTime, formatRupiah, statusLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Harga jasa servis: teknisi mengirim temuan, lalu kasir/admin menetapkan harga
// jasa (sesuai tingkat kesulitan) dari halaman job. Sparepart yang disetujui
// ikut masuk ke tagihan yang sama.

/** Teknisi/admin: tombol "Kirim Temuan" + status. Memberi notifikasi ke kasir & admin. */
export function SendFindingsBar({
  jobId,
  findingCount,
  withoutBeforePhoto,
  findingsSentAt,
  priced,
}: {
  jobId: string;
  findingCount: number;
  /** Jumlah temuan yang belum punya foto sebelum; tombol kirim mati selama > 0. */
  withoutBeforePhoto: number;
  findingsSentAt: string | null;
  priced: boolean;
}) {
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: () => apiClient.post(`/technician-jobs/${jobId}/send-findings`),
    onSuccess: () => {
      toast.success('Temuan terkirim ke kasir dan admin.');
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengirim temuan.');
    },
  });

  return (
    <div className="grid gap-2 rounded-md border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Sudah selesai mencatat temuan?</p>
          <p className="text-xs text-muted-foreground">
            Kirim ke kasir dan admin supaya mereka menentukan tindakan dan harga jasanya.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="disabled:opacity-40"
          disabled={findingCount === 0 || withoutBeforePhoto > 0 || send.isPending}
          onClick={() => send.mutate()}
        >
          <Send className="size-4" />
          {send.isPending ? 'Mengirim...' : findingsSentAt ? 'Kirim Ulang Temuan' : 'Kirim Temuan'}
        </Button>
      </div>
      {findingCount === 0 && <p className="text-xs text-muted-foreground">Tambah minimal 1 temuan dulu.</p>}
      {findingCount > 0 && withoutBeforePhoto > 0 && (
        <p className="text-xs text-muted-foreground">
          Isi foto sebelum dulu: {withoutBeforePhoto} dari {findingCount} temuan belum punya foto sebelum.
        </p>
      )}
      {findingsSentAt && !priced && (
        <p className="text-xs text-status-warning-foreground dark:text-status-warning">
          Temuan terkirim {formatDateTime(findingsSentAt)}. Menunggu harga jasa dari kasir/admin.
        </p>
      )}
      {priced && <p className="text-xs text-status-success">Harga jasa sudah ditetapkan.</p>}
    </div>
  );
}

interface CatalogService {
  id: string;
  name: string;
  basePrice: string;
}
interface PricingLine {
  id: string;
  serviceId: string | null;
  name: string;
  qty: number;
  unitPrice: number;
}
interface PricingData {
  jobId: string;
  status: string;
  findingsSentAt: string | null;
  editable: boolean;
  priced: boolean;
  invoice: { id: string; number: string; status: string; grandTotal: string; totalPaid: string } | null;
  lines: PricingLine[];
  transport: { level: number; mode: 'individu' | 'dibagi'; amount: number };
  billed: { id: string; kind: string; name: string; unit: string | null; qty: number; unitPrice: number; lineTotal: number }[];
  sparepart: {
    total: number;
    requests: {
      id: string;
      amount: number;
      used: boolean;
      legacy: boolean;
      items: { name: string; qty: number; qtyUsed: number | null; unit: string | null; unitPrice: number }[];
    }[];
  };
}
interface Row {
  serviceId: string; // '' = jasa lain (ketik nama)
  name: string;
  qty: string;
  unitPrice: string;
}
interface PreviewLine {
  key: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

const FREE = '__free__';

// Sama dengan pemetaan di halaman Riwayat Transaksi: lunas hijau, selain itu kuning.
function invoiceStatusVariant(status: string): 'success' | 'warning' | 'secondary' {
  if (status === 'lunas') return 'success';
  if (status === 'batal' || status === 'refund') return 'secondary';
  return 'warning';
}
const TRANSPORT_STEP = 100000;
const TRANSPORT_LEVELS = [1, 2, 3, 4, 5];

function toRows(lines: PricingLine[]): Row[] {
  if (lines.length === 0) return [{ serviceId: '', name: '', qty: '1', unitPrice: '' }];
  return lines.map((l) => ({
    serviceId: l.serviceId ?? '',
    name: l.name,
    qty: String(l.qty),
    unitPrice: String(l.unitPrice),
  }));
}

/** Padanan JobBillingService di backend: jasa + sparepart (+ transport) -> baris yang tampil di tagihan/struk. */
function buildPreview(
  services: { name: string; qty: number; unitPrice: number }[],
  spareparts: { name: string; qty: number; unitPrice: number }[],
  transport: number,
  mode: 'individu' | 'dibagi',
): PreviewLine[] {
  const base = [...services, ...spareparts].map((l, i) => ({
    key: `l${i}`,
    name: l.name,
    qty: l.qty,
    unitPrice: l.unitPrice,
    lineTotal: Math.round(l.qty * l.unitPrice),
  }));
  if (transport <= 0) return base;
  if (mode === 'dibagi' && base.length > 0) {
    const share = Math.floor(transport / base.length);
    const rem = transport - share * base.length;
    return base.map((l, i) => {
      const lineTotal = l.lineTotal + share + (i === 0 ? rem : 0);
      return { ...l, lineTotal, unitPrice: Math.round((lineTotal / l.qty) * 100) / 100 };
    });
  }
  return [...base, { key: 'transport', name: 'Biaya transport', qty: 1, unitPrice: transport, lineTotal: transport }];
}

/** Admin/kasir: tetapkan harga jasa per job + transport (opsional). Dari Master Jasa (harga boleh diubah) atau jasa lain. */
export function ServicePricingCard({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const pricingQuery = useQuery({
    queryKey: ['technician-jobs', jobId, 'service-pricing'],
    queryFn: () => apiClient.get<PricingData>(`/technician-jobs/${jobId}/service-pricing`),
  });
  const servicesQuery = useQuery({
    queryKey: ['services', 'active'],
    queryFn: () => apiClient.get<CatalogService[]>('/services?status=active'),
  });

  // Isian: null = belum disentuh (ikut data tersimpan dari server).
  const [edited, setEdited] = React.useState<Row[] | null>(null);
  const [transportLevel, setTransportLevel] = React.useState<number | null>(null);
  const [transportMode, setTransportMode] = React.useState<'individu' | 'dibagi' | null>(null);
  // Invoice hasil penetapan harga: memunculkan dialog "invoice sudah dibuat" + tombol Cek Invoice.
  const [doneInvoice, setDoneInvoice] = React.useState<{ id: string; number: string; created: boolean } | null>(null);
  const data = pricingQuery.data;
  const rows = edited ?? (data ? toRows(data.lines) : []);
  const level = transportLevel ?? data?.transport.level ?? 0;
  const mode = transportMode ?? data?.transport.mode ?? 'individu';
  const catalog = servicesQuery.data ?? [];

  function update(i: number, patch: Partial<Row>) {
    setEdited(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function pickService(i: number, value: string) {
    if (value === FREE) {
      update(i, { serviceId: '', name: '' });
      return;
    }
    const svc = catalog.find((s) => s.id === value);
    update(i, {
      serviceId: value,
      name: svc?.name ?? '',
      unitPrice: rows[i].unitPrice === '' && svc ? String(Number(svc.basePrice)) : rows[i].unitPrice,
    });
  }

  const validRows = rows.filter((r) => (r.serviceId || r.name.trim()) && r.unitPrice !== '' && Number(r.qty) > 0);
  const allRowsValid = rows.length > 0 && validRows.length === rows.length;

  // Pratinjau: sparepart yang disetujui jadi baris bernama (jumlah terpakai kalau sudah dilaporkan);
  // pengajuan jalur lama (legacy) tetap sebagai "tambahan" gabungan di luar baris job.
  const sparepartLines = (data?.sparepart.requests ?? [])
    .filter((r) => !r.legacy)
    .flatMap((r) =>
      r.items
        .map((i) => ({ name: i.name, qty: r.used ? (i.qtyUsed ?? i.qty) : i.qty, unitPrice: i.unitPrice }))
        .filter((i) => i.qty > 0),
    );
  const legacyTotal = (data?.sparepart.requests ?? []).filter((r) => r.legacy).reduce((s, r) => s + r.amount, 0);
  const preview = buildPreview(
    validRows.map((r) => ({ name: r.name.trim() || catalog.find((c) => c.id === r.serviceId)?.name || 'Jasa', qty: Number(r.qty), unitPrice: Number(r.unitPrice) })),
    sparepartLines,
    level * TRANSPORT_STEP,
    mode,
  );
  const previewTotal = preview.reduce((s, l) => s + l.lineTotal, 0) + legacyTotal;

  const save = useMutation({
    mutationFn: () =>
      apiClient.put(`/technician-jobs/${jobId}/service-pricing`, {
        lines: validRows.map((r) => ({
          serviceId: r.serviceId || undefined,
          name: r.name.trim() || undefined,
          qty: Number(r.qty),
          unitPrice: Number(r.unitPrice),
        })),
        transportLevel: level,
        transportMode: mode,
      }),
    onSuccess: (res) => {
      const inv = (res as { invoice?: { id: string; number: string } | null } | undefined)?.invoice;
      if (inv) setDoneInvoice({ id: inv.id, number: inv.number, created: !data?.priced });
      toast.success('Harga jasa ditetapkan.');
      setEdited(null);
      setTransportLevel(null);
      setTransportMode(null);
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menetapkan harga jasa.');
    },
  });

  if (pricingQuery.isLoading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">Memuat harga jasa...</CardContent>
      </Card>
    );
  }
  if (pricingQuery.isError || !data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">Gagal memuat harga jasa.</CardContent>
      </Card>
    );
  }

  const editable = data.editable;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          Harga Jasa &amp; Tagihan
          {data.findingsSentAt ? (
            <Badge variant="warning">Temuan terkirim {formatDateTime(data.findingsSentAt)}</Badge>
          ) : (
            <Badge variant="secondary">Teknisi belum mengirim temuan</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Tentukan harga jasa setelah melihat temuan dan foto di atas. Harga tiap kasus boleh berbeda sesuai
          tingkat kesulitan. Sparepart yang disetujui otomatis masuk ke tagihan yang sama. Hasilnya menjadi
          invoice dan struk yang bisa dikirim ke WhatsApp pelanggan.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div
          aria-hidden="true"
          className="hidden px-[13px] text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1.4fr)_5rem_minmax(0,1fr)_2.25rem] sm:gap-2"
        >
          <span>Jasa</span>
          <span>Jumlah</span>
          <span>Harga satuan</span>
          <span />
        </div>
        {rows.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-[5rem_minmax(0,1fr)_auto] gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1.4fr)_5rem_minmax(0,1fr)_auto] sm:items-start"
          >
            <div className="col-span-3 grid gap-1.5 sm:col-span-1">
              <Select value={row.serviceId || FREE} onValueChange={(v) => pickService(i, v)} disabled={!editable}>
                <SelectTrigger className="w-full" aria-label="Pilih jasa">
                  <SelectValue placeholder="Pilih jasa" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({formatRupiah(s.basePrice)})
                    </SelectItem>
                  ))}
                  <SelectItem value={FREE}>Jasa lain (ketik nama)</SelectItem>
                </SelectContent>
              </Select>
              {(!row.serviceId || row.name) && (
                <Input
                  placeholder={row.serviceId ? 'Nama di tagihan (boleh diubah)' : 'Nama jasa, mis. Bongkar kompresor'}
                  value={row.name}
                  disabled={!editable}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              )}
            </div>
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="any"
              aria-label="Jumlah"
              value={row.qty}
              disabled={!editable}
              onChange={(e) => update(i, { qty: e.target.value })}
            />
            <CurrencyInput
              aria-label="Harga satuan"
              placeholder="Harga (Rp)"
              value={row.unitPrice}
              disabled={!editable}
              onChange={(v) => update(i, { unitPrice: v })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Hapus baris"
              disabled={!editable || rows.length <= 1}
              onClick={() => setEdited(rows.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setEdited([...rows, { serviceId: '', name: '', qty: '1', unitPrice: '' }])}
          >
            <Plus className="size-4" />
            Tambah baris
          </Button>
        )}

        {/* Transport (opsional): kelipatan Rp 100.000, maksimal Transport 5. */}
        <div className="grid gap-2 border-t pt-3">
          <div>
            <p className="text-sm font-medium">Transport (opsional)</p>
            <p className="text-xs text-muted-foreground">Kosongkan kalau tidak ada biaya transport.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              value={String(level)}
              onValueChange={(v) => setTransportLevel(Number(v))}
              disabled={!editable}
            >
              <SelectTrigger className="w-full" aria-label="Pilih transport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Tanpa transport</SelectItem>
                {TRANSPORT_LEVELS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    Transport {n} ({formatRupiah(n * TRANSPORT_STEP)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {level > 0 && (
              <Select value={mode} onValueChange={(v) => setTransportMode(v as 'individu' | 'dibagi')} disabled={!editable}>
                <SelectTrigger className="w-full" aria-label="Cara menagihkan transport">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individu">Tampilkan sebagai biaya transport</SelectItem>
                  <SelectItem value="dibagi">Bagi rata ke jasa &amp; sparepart</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          {level > 0 && (
            <p className="text-xs text-muted-foreground">
              {mode === 'dibagi'
                ? 'Transport dibagi sama rata ke tiap baris jasa dan sparepart. Di struk tidak ada tulisan transport; harga tiap baris sudah naik sebesar bagiannya.'
                : 'Transport tampil sebagai baris "Biaya transport" sendiri di tagihan dan struk.'}
            </p>
          )}
        </div>

        {/* Pratinjau: persis baris yang akan tampil di invoice/struk pelanggan. */}
        <div className="grid gap-1 rounded-md bg-muted px-3 py-2 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Tampil di tagihan &amp; struk</p>
          {preview.length === 0 && <p className="text-xs text-muted-foreground">Isi baris jasa di atas.</p>}
          {preview.map((l) => (
            <div key={l.key} className="flex justify-between gap-3">
              <span className="min-w-0">
                {l.name}
                <span className="text-xs text-muted-foreground">
                  {' '}
                  {l.qty} x {formatRupiah(l.unitPrice)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{formatRupiah(l.lineTotal)}</span>
            </div>
          ))}
          {legacyTotal > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Sparepart (pengajuan lama)</span>
              <span className="tabular-nums">{formatRupiah(legacyTotal)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t pt-1 font-medium">
            <span>Total tagihan servis ini</span>
            <span className="tabular-nums">{formatRupiah(previewTotal)}</span>
          </div>
          {allRowsValid && previewTotal === 0 && (
            <p className="text-xs text-muted-foreground">Total Rp 0 = servis gratis/garansi.</p>
          )}
        </div>

        {data.invoice && (
          <div className="grid gap-3 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{data.invoice.number}</span>
                <Badge variant={invoiceStatusVariant(data.invoice.status)}>{statusLabel(data.invoice.status)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                Dibayar {formatRupiah(data.invoice.totalPaid)} dari {formatRupiah(data.invoice.grandTotal)}
                {Number(data.invoice.grandTotal) - Number(data.invoice.totalPaid) > 0 &&
                  ` • sisa ${formatRupiah(Number(data.invoice.grandTotal) - Number(data.invoice.totalPaid))}`}
              </p>
              <p className="text-xs text-muted-foreground">
                Konfirmasi pembayaran dan kirim struk ke WhatsApp dari halaman invoice.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href={`/invoices/${data.invoice.id}`}>
                <FileText className="size-4" />
                Cek Invoice
              </Link>
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          {(!editable || !data.invoice) && (
            <p className="text-xs text-muted-foreground">
              {editable ? 'Tagihan dibuat saat harga jasa pertama kali ditetapkan.' : 'Job sudah selesai/dibatalkan, harga tidak bisa diubah.'}
            </p>
          )}
          {editable && (
            <Button type="button" className="ml-auto" disabled={!allRowsValid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Menyimpan...' : data.priced ? 'Perbarui Harga Jasa' : 'Tetapkan Harga Jasa'}
            </Button>
          )}
        </div>
        {!allRowsValid && editable && (
          <p className="text-xs text-muted-foreground">
            Lengkapi tiap baris: pilih atau ketik nama jasa, jumlah, dan harga (isi 0 untuk gratis).
          </p>
        )}
      </CardContent>
      <Dialog open={!!doneInvoice} onOpenChange={(o) => !o && setDoneInvoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{doneInvoice?.created ? 'Invoice sudah dibuat' : 'Invoice diperbarui'}</DialogTitle>
            <DialogDescription>
              {doneInvoice?.created
                ? `Invoice ${doneInvoice?.number} sudah dibuat dari harga jasa ini.`
                : `Harga di invoice ${doneInvoice?.number} sudah diperbarui.`}{' '}
              Buka invoice untuk melanjutkan konfirmasi pembayaran dan mengirim struk ke WhatsApp pelanggan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDoneInvoice(null)}>
              Tutup
            </Button>
            <Button asChild>
              <Link href={`/invoices/${doneInvoice?.id}`}>
                <FileText className="size-4" />
                Cek Invoice
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
