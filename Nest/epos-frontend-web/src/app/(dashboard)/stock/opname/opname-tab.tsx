'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ClipboardCheck, Info, Search } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { requiredNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

interface Sparepart {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  stock: string;
  minStock: string;
  batchTracked: boolean;
}

// Satu gulungan/batch sparepart yang dilacak per gulungan (pipa, kabel).
interface SparepartBatch {
  id: string;
  supplierName: string | null;
  stock: string;
  createdAt: string;
}

interface OpnameResult {
  refId: string;
  itemCostId: string | null;
  name: string;
  systemQty: number;
  physicalQty: number;
  delta: number;
}

function toastOpnameResult(result: OpnameResult) {
  if (result.delta === 0) {
    toast.success('Stok sudah sesuai, tidak ada perubahan.');
    return;
  }
  const sign = result.delta > 0 ? '+' : '';
  toast.success(`Stok dikoreksi ${sign}${result.delta} (sistem ${result.systemQty}, fisik ${result.physicalQty}).`);
}

const opnameSchema = z.object({
  physicalQty: requiredNumberField('Stok fisik wajib diisi'),
  note: z.string().optional(),
});
type OpnameValues = z.infer<typeof opnameSchema>;
const emptyValues: OpnameValues = { physicalQty: '', note: '' };

// Opname = hitung fisik lalu samakan angka sistem. Hanya sparepart: stok produk
// AC dihitung dari unit QR (bukan angka), jadi backend menolak opname produk.
export function OpnameTab() {
  return (
    <div className="grid gap-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Stok produk AC tidak diopname lewat angka</p>
              <p className="text-sm text-muted-foreground">
                Stok AC dihitung dari unit QR. Untuk mencocokkan fisik, cetak Laporan Stok per merk lalu hitung unit di rak.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/stock/laporan">Buka Laporan Stok</Link>
          </Button>
        </CardContent>
      </Card>

      <SparepartOpname />
    </div>
  );
}

function SparepartOpname() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [batchId, setBatchId] = React.useState<string | null>(null);

  const sparepartsQuery = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });
  // Selalu baca ulang dari daftar terbaru (stok sistem berubah setelah koreksi).
  const selected = sparepartsQuery.data?.find((s) => s.id === selectedId) ?? null;

  const batchesQuery = useQuery({
    queryKey: ['sparepart-batches', selectedId],
    queryFn: () => apiClient.get<SparepartBatch[]>(`/spareparts/${selectedId}/batches`),
    enabled: !!selected?.batchTracked,
  });
  const batch = batchesQuery.data?.find((b) => b.id === batchId) ?? null;

  const form = useForm<OpnameValues>({ resolver: zodResolver(opnameSchema), defaultValues: emptyValues });

  // Per gulungan: yang dihitung stok gulungan itu. Selain itu: stok total.
  const needsBatch = !!selected?.batchTracked;
  const systemQty = needsBatch ? Number(batch?.stock ?? 0) : Number(selected?.stock ?? 0);
  const physicalRaw = form.watch('physicalQty');
  const hasPhysical = String(physicalRaw ?? '').trim() !== '' && !Number.isNaN(Number(physicalRaw));
  const delta = hasPhysical ? Math.round((Number(physicalRaw) - systemQty) * 100) / 100 : null;

  function pick(s: Sparepart) {
    setSelectedId(s.id);
    setBatchId(null);
    form.reset(emptyValues);
  }

  const mutation = useMutation({
    mutationFn: (values: OpnameValues) =>
      apiClient.post<OpnameResult[]>('/stock/opname', {
        items: [
          {
            kind: 'sparepart',
            refId: selected!.id,
            ...(needsBatch ? { itemCostId: batchId } : {}),
            physicalQty: Number(values.physicalQty),
          },
        ],
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: (result) => {
      toastOpnameResult(result[0]);
      form.reset(emptyValues);
      void queryClient.invalidateQueries({ queryKey: ['spareparts'] });
      void queryClient.invalidateQueries({ queryKey: ['sparepart-batches', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan opname.');
    },
  });

  const q = search.trim().toLowerCase();
  const filtered = (sparepartsQuery.data ?? []).filter(
    (s) => s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q),
  );

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Pilih sparepart</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-3">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Cari nama atau kategori..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {sparepartsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada sparepart.</p>
          ) : (
            <div className="grid max-h-[65vh] gap-1 overflow-y-auto">
              {filtered.map((s) => {
                const low = Number(s.minStock) > 0 && Number(s.stock) <= Number(s.minStock);
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => pick(s)}
                    className={`rounded-md px-2 py-2 text-left transition-colors hover:bg-accent ${selectedId === s.id ? 'bg-accent' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{s.name}</p>
                      <div className="flex shrink-0 gap-1">
                        {s.batchTracked && <Badge variant="outline">Per gulungan</Badge>}
                        {low && <Badge variant="warning">Menipis</Badge>}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {s.category ?? 'Tanpa kategori'} • Stok {Number(s.stock)} {s.unit}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{selected ? `2. Hitung fisik: ${selected.name}` : '2. Hitung fisik'}</CardTitle>
          {selected && (
            <CardDescription>Isi jumlah yang kamu hitung di rak. Selisihnya dihitung otomatis.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {!selected ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <ClipboardCheck className="size-8" />
              Pilih sparepart di sebelah kiri untuk mulai opname.
            </div>
          ) : (
            <div className="grid gap-4">
              {needsBatch && (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Pilih gulungan yang dihitung</p>
                  {batchesQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Memuat gulungan...</p>
                  ) : (batchesQuery.data ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Tidak ada gulungan yang masih ada stoknya.</p>
                  ) : (
                    <div className="grid gap-1">
                      {batchesQuery.data!.map((b) => (
                        <button
                          type="button"
                          key={b.id}
                          onClick={() => {
                            setBatchId(b.id);
                            form.reset(emptyValues);
                          }}
                          className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${batchId === b.id ? 'border-primary bg-accent' : ''}`}
                        >
                          <span>
                            Masuk {formatDate(b.createdAt)}
                            {b.supplierName ? ` • ${b.supplierName}` : ''}
                          </span>
                          <span className="font-medium">
                            {Number(b.stock)} {selected.unit}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(!needsBatch || batch) && (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="grid gap-4">
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <span className="text-sm text-muted-foreground">{needsBatch ? 'Stok sistem (gulungan ini)' : 'Stok sistem'}</span>
                      <span className="text-lg font-semibold">
                        {systemQty} {selected.unit}
                      </span>
                    </div>
                    <FormField
                      control={form.control}
                      name="physicalQty"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Stok fisik ({selected.unit})</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="Jumlah hasil hitung" autoFocus {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {delta !== null && (
                      <p
                        role="status"
                        className={`rounded-md px-3 py-2 text-sm ${
                          delta === 0
                            ? 'bg-green-600/10 text-green-800 dark:text-green-300'
                            : 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
                        }`}
                      >
                        {delta === 0
                          ? 'Sesuai dengan stok sistem.'
                          : `Selisih ${delta > 0 ? '+' : ''}${delta} ${selected.unit}: stok sistem akan disetel ke ${Number(physicalRaw)}.`}
                      </p>
                    )}
                    <FormField
                      control={form.control}
                      name="note"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Catatan</FormLabel>
                          <FormControl>
                            <Textarea rows={2} placeholder="Opsional, mis. barang rusak atau salah catat" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" disabled={mutation.isPending || delta === null}>
                      {mutation.isPending ? 'Menyimpan...' : delta === 0 ? 'Simpan (sudah sesuai)' : delta === null ? 'Simpan opname' : `Koreksi stok ${delta > 0 ? '+' : ''}${delta}`}
                    </Button>
                  </form>
                </Form>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
