'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFieldPayments } from './payment-card';

// Teknisi melihat harga jasa yang ditetapkan admin dan boleh menyesuaikannya di lokasi: ubah jumlah, hapus baris, tambah
// jasa dari katalog (harga katalog), atau "jasa lain" (nama + harga). Wajib beralasan; admin & kasir dikabari dan melihat
// penandanya di kartu Harga Jasa. Harga satuan baris dari admin dan transport tidak bisa diubah teknisi.

interface PriceLine {
  id: string;
  serviceId: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  source?: 'admin' | 'teknisi';
  isCustom?: boolean;
  changeReason?: string | null;
}
interface PriceData {
  jobId: string;
  status: string;
  priced: boolean;
  editable: boolean;
  invoice: { id: string; number: string; status: string; grandTotal: string; totalPaid: string } | null;
  lines: PriceLine[];
  transport: { level: number; mode: 'individu' | 'dibagi'; amount: number };
  sparepart: { total: number };
  techEdit?: { at: string; reason: string | null; subtotalBefore: number; subtotalAfter: number } | null;
}
interface CatalogService {
  id: string;
  name: string;
  basePrice: string;
}

/** Baris di dialog sesuaikan. `id` ada = baris yang sudah ada (hanya jumlah yang bisa diubah). */
interface EditRow {
  key: string;
  id?: string;
  serviceId?: string;
  name: string;
  qty: string;
  unitPrice: string;
  custom: boolean;
}

const rowTotal = (r: EditRow) => Math.round((Number(r.qty) || 0) * (Number(r.unitPrice) || 0));

export function TechnicianPriceCard({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const [open, setOpen] = React.useState(false);
  const priceQuery = useQuery({
    queryKey: ['technician-jobs', jobId, 'service-pricing'],
    queryFn: () => apiClient.get<PriceData>(`/technician-jobs/${jobId}/service-pricing`),
    retry: false,
  });
  const paymentsQuery = useFieldPayments(jobId);
  const data = priceQuery.data;
  if (!data) return null;
  // Hanya untuk order yang dibayar di lokasi: order lama / instansi (ditagih admin) tidak berubah perilakunya. Selama
  // ringkasan pembayaran belum termuat, kartu disembunyikan.
  if (paymentsQuery.data?.paymentMode !== 'bayar_di_lokasi') return null;

  // Tanda Terima sudah terbit (ada pembayaran yang tidak ditolak): jasa dikunci supaya sama dengan bukti pelanggan.
  const locked = (paymentsQuery.data?.payments ?? []).some((p) => p.status !== 'ditolak');
  const total = data.invoice ? Number(data.invoice.grandTotal) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          Harga Jasa
          {data.techEdit && <Badge variant="warning">Sudah kamu sesuaikan</Badge>}
        </CardTitle>
        <CardDescription>
          Harga ditetapkan admin. Kalau di lokasi ada pekerjaan yang berbeda dari perkiraan, sesuaikan di sini dengan
          alasan. Perubahan langsung berlaku, tidak perlu menunggu admin; admin hanya diberi tahu.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!data.priced ? (
          <p className="text-sm text-muted-foreground">Admin belum menetapkan harga jasa untuk pekerjaan ini.</p>
        ) : (
          <>
            <ul className="grid gap-1.5 text-sm">
              {data.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0">
                    {l.name}
                    {l.isCustom && <Badge variant="secondary" className="ml-2">Jasa lain</Badge>}
                    {l.source === 'teknisi' && !l.isCustom && <Badge variant="warning" className="ml-2">Disesuaikan</Badge>}
                    <span className="text-muted-foreground">
                      {' '}
                      · {l.qty} x {formatRupiah(l.unitPrice)}
                    </span>
                  </span>
                  <span className="font-medium">{formatRupiah(Math.round(l.qty * l.unitPrice))}</span>
                </li>
              ))}
              {data.transport.amount > 0 && (
                <li className="flex justify-between gap-3 text-muted-foreground">
                  <span>Biaya transport</span>
                  <span>{formatRupiah(data.transport.amount)}</span>
                </li>
              )}
              {data.sparepart.total > 0 && (
                <li className="flex justify-between gap-3 text-muted-foreground">
                  <span>Sparepart yang disetujui</span>
                  <span>{formatRupiah(data.sparepart.total)}</span>
                </li>
              )}
            </ul>
            {total !== null && (
              <p className="flex justify-between border-t pt-2 text-sm font-semibold">
                <span>Total tagihan</span>
                <span>{formatRupiah(total)}</span>
              </p>
            )}
            {canEdit && !locked && (
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                <Pencil className="size-4" />
                Sesuaikan Jasa
              </Button>
            )}
            {canEdit && locked && (
              <p className="text-xs text-muted-foreground">
                Pembayaran sudah dicatat dan Tanda Terima sudah terbit, jadi jasa tidak bisa disesuaikan lagi. Hubungi admin
                untuk koreksi.
              </p>
            )}
          </>
        )}
      </CardContent>
      {open && <AdjustDialog jobId={jobId} data={data} open={open} onOpenChange={setOpen} />}
    </Card>
  );
}

function AdjustDialog({
  jobId,
  data,
  open,
  onOpenChange,
}: {
  jobId: string;
  data: PriceData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const servicesQuery = useQuery({
    queryKey: ['services', 'active'],
    queryFn: () => apiClient.get<CatalogService[]>('/services?status=active'),
  });
  const initial = React.useMemo<EditRow[]>(
    () =>
      data.lines.map((l) => ({
        key: l.id,
        id: l.id,
        serviceId: l.serviceId ?? undefined,
        name: l.name,
        qty: String(l.qty),
        unitPrice: String(l.unitPrice),
        custom: !!l.isCustom,
      })),
    [data.lines],
  );
  const [rows, setRows] = React.useState<EditRow[]>(initial);
  const [reason, setReason] = React.useState('');
  const keySeq = React.useRef(0);
  // Dialog hanya dipasang saat terbuka (lihat TechnicianPriceCard), jadi isian selalu mulai dari data terbaru.

  const nextKey = () => `new-${keySeq.current++}`;
  const update = (key: string, patch: Partial<EditRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const changed =
    rows.length !== initial.length ||
    rows.some((r) => !r.id || Number(initial.find((i) => i.id === r.id)?.qty) !== Number(r.qty));
  const rowsOk =
    rows.length > 0 &&
    rows.every(
      (r) => Number(r.qty) > 0 && (!r.custom || r.id || (r.name.trim().length > 0 && r.unitPrice !== '' && Number(r.unitPrice) >= 0)),
    );
  const valid = changed && rowsOk && reason.trim().length >= 5;
  const newSubtotal = rows.reduce((s, r) => s + rowTotal(r), 0);
  const oldSubtotal = initial.reduce((s, r) => s + rowTotal(r), 0);

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch(`/technician-jobs/${jobId}/service-lines`, {
        reason: reason.trim(),
        lines: rows.map((r) =>
          r.id
            ? { id: r.id, qty: Number(r.qty) }
            : r.serviceId && !r.custom
              ? { serviceId: r.serviceId, qty: Number(r.qty) }
              : { name: r.name.trim(), qty: Number(r.qty), unitPrice: Number(r.unitPrice) },
        ),
      }),
    onSuccess: () => {
      toast.success('Jasa disesuaikan dan langsung berlaku. Admin sudah diberi tahu.');
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['technician-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['field-payments'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menyesuaikan jasa.'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Sesuaikan Jasa</DialogTitle>
          <DialogDescription>
            Ubah jumlah, hapus baris, atau tambah jasa. Harga baris dari admin tidak bisa diubah; jasa di luar katalog
            ditambahkan sebagai jasa lain.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {rows.map((r) => (
            <div key={r.key} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_5rem_auto] sm:items-start">
              <div className="grid gap-1.5">
                {r.custom && !r.id ? (
                  <Input
                    value={r.name}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    placeholder="Nama jasa lain"
                    aria-label="Nama jasa lain"
                  />
                ) : (
                  <p className="text-sm font-medium">{r.name}</p>
                )}
                {r.custom && !r.id ? (
                  <CurrencyInput
                    value={r.unitPrice}
                    onChange={(v) => update(r.key, { unitPrice: v })}
                    aria-label="Harga jasa lain"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {formatRupiah(Number(r.unitPrice) || 0)} per satuan {r.id ? '(harga tetap)' : '(harga katalog)'}
                  </p>
                )}
              </div>
              <Input
                inputMode="decimal"
                value={r.qty}
                onChange={(e) => update(r.key, { qty: e.target.value.replace(/[^\d.]/g, '') })}
                aria-label="Jumlah"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Hapus baris"
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value=""
            onValueChange={(id) => {
              const svc = servicesQuery.data?.find((s) => s.id === id);
              if (!svc) return;
              setRows((rs) => [
                ...rs,
                { key: nextKey(), serviceId: svc.id, name: svc.name, qty: '1', unitPrice: String(Number(svc.basePrice)), custom: false },
              ]);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Tambah dari katalog">
              <SelectValue placeholder="Tambah dari katalog jasa" />
            </SelectTrigger>
            <SelectContent>
              {(servicesQuery.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} - {formatRupiah(Number(s.basePrice))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRows((rs) => [...rs, { key: nextKey(), name: '', qty: '1', unitPrice: '', custom: true }])}
          >
            <Plus className="size-4" />
            Jasa lain
          </Button>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`adjust-reason-${jobId}`}>Alasan penyesuaian (wajib)</Label>
          <Textarea
            id={`adjust-reason-${jobId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Mis. pelanggan minta satu unit AC lagi ikut dicuci"
            rows={2}
          />
        </div>

        <p className="text-sm text-muted-foreground">
          Subtotal jasa: {formatRupiah(oldSubtotal)} menjadi <span className="font-semibold text-foreground">{formatRupiah(newSubtotal)}</span>
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="button" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Menyimpan...' : 'Simpan Penyesuaian'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
