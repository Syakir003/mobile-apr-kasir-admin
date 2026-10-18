'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Send, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDateTime, formatRupiah, statusLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Harga jasa servis: teknisi mengirim temuan, lalu kasir/admin menetapkan harga
// jasa (sesuai tingkat kesulitan) dari halaman job. Sparepart yang disetujui
// ikut masuk ke tagihan yang sama.

/** Teknisi/admin: tombol "Kirim Temuan" + status. Memberi notifikasi ke kasir & admin. */
export function SendFindingsBar({
  jobId,
  findingCount,
  findingsSentAt,
  priced,
}: {
  jobId: string;
  findingCount: number;
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
          disabled={findingCount === 0 || send.isPending}
          onClick={() => send.mutate()}
        >
          <Send className="size-4" />
          {send.isPending ? 'Mengirim...' : findingsSentAt ? 'Kirim Ulang Temuan' : 'Kirim Temuan'}
        </Button>
      </div>
      {findingCount === 0 && <p className="text-xs text-muted-foreground">Tambah minimal 1 temuan dulu.</p>}
      {findingsSentAt && !priced && (
        <p className="text-xs text-status-warning">
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
  refId: string | null;
  name: string;
  qty: string;
  unitPrice: string;
}
interface PricingData {
  jobId: string;
  status: string;
  findingsSentAt: string | null;
  editable: boolean;
  priced: boolean;
  invoice: { id: string; number: string; status: string; grandTotal: string; totalPaid: string } | null;
  lines: PricingLine[];
  jasaTotal: number;
  sparepart: {
    total: number;
    requests: {
      id: string;
      amount: number;
      used: boolean;
      items: { name: string; qty: number; qtyUsed: number | null; unit: string | null }[];
    }[];
  };
}
interface Row {
  serviceId: string; // '' = jasa lain (ketik nama)
  name: string;
  qty: string;
  unitPrice: string;
}

const FREE = '__free__';

function toRows(lines: PricingLine[]): Row[] {
  if (lines.length === 0) return [{ serviceId: '', name: '', qty: '1', unitPrice: '' }];
  return lines.map((l) => ({
    serviceId: l.refId ?? '',
    name: l.name,
    qty: String(Number(l.qty)),
    unitPrice: String(Number(l.unitPrice)),
  }));
}

/** Admin/kasir: tetapkan harga jasa per job. Dari Master Jasa (harga boleh diubah) atau jasa lain. */
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

  // Isian baris: null = belum disentuh (ikut data tersimpan dari server).
  const [edited, setEdited] = React.useState<Row[] | null>(null);
  const data = pricingQuery.data;
  const rows = edited ?? (data ? toRows(data.lines) : []);
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
  const jasaTotal = validRows.reduce((s, r) => s + Math.round(Number(r.qty) * Number(r.unitPrice)), 0);
  const allRowsValid = rows.length > 0 && validRows.length === rows.length;
  const sparepartTotal = data?.sparepart.total ?? 0;

  const save = useMutation({
    mutationFn: () =>
      apiClient.put(`/technician-jobs/${jobId}/service-pricing`, {
        lines: validRows.map((r) => ({
          serviceId: r.serviceId || undefined,
          name: r.name.trim() || undefined,
          qty: Number(r.qty),
          unitPrice: Number(r.unitPrice),
        })),
      }),
    onSuccess: () => {
      toast.success('Harga jasa ditetapkan.');
      setEdited(null);
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
          tingkat kesulitan. Sparepart yang disetujui otomatis masuk ke tagihan yang sama.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map((row, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1.4fr)_5rem_minmax(0,1fr)_auto] sm:items-start">
            <div className="grid gap-1.5">
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

        <div className="grid gap-1 rounded-md bg-muted px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Jasa</span>
            <span>{formatRupiah(jasaTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sparepart disetujui</span>
            <span>{formatRupiah(sparepartTotal)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Total tagihan</span>
            <span>{formatRupiah(jasaTotal + sparepartTotal)}</span>
          </div>
          {allRowsValid && jasaTotal === 0 && (
            <p className="text-xs text-muted-foreground">Total jasa Rp 0 = servis gratis/garansi.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {data.invoice ? (
            <p className="text-xs text-muted-foreground">
              Tagihan{' '}
              <Link href={`/invoices/${data.invoice.id}`} className="font-medium underline">
                {data.invoice.number}
              </Link>{' '}
              • {statusLabel(data.invoice.status)} • {formatRupiah(data.invoice.grandTotal)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Tagihan dibuat saat harga jasa pertama kali ditetapkan.</p>
          )}
          {editable ? (
            <Button type="button" disabled={!allRowsValid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Menyimpan...' : data.priced ? 'Perbarui Harga Jasa' : 'Tetapkan Harga Jasa'}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Job sudah selesai/dibatalkan, harga tidak bisa diubah.</p>
          )}
        </div>
        {!allRowsValid && editable && (
          <p className="text-xs text-muted-foreground">
            Lengkapi tiap baris: pilih atau ketik nama jasa, jumlah, dan harga (isi 0 untuk gratis).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
