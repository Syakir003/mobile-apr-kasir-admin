'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah, formatDate } from '@/lib/format';
import { requiredNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { formatStock, hasPackSale, type SparepartMode } from '@/lib/sparepart-mode';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Halaman detail sparepart — pasangan product-detail-client.tsx, dibikin
// per keputusan 2026-09-15 (halaman penuh, bukan dialog popup). Beda sama
// Produk: gak ada endpoint GET /spareparts/:id di backend (SparepartsController
// cuma punya findAll/search/create/update), jadi datanya diambil dari list
// /spareparts terus dicari by id di sini — sama kayak pola lama yang dipakai
// dialog "Stok" sebelumnya.
//
// Siklus sparepart-per-gulungan (2026-09-23): kalau sparepart.batchTracked,
// form barang masuk BEDA — admin isi jumlah gulungan + panjang tiap gulungan
// (bisa beda-beda), SATU harga modal berlaku buat semua gulungan di 1 nota,
// dan ada tabel "Gulungan Aktif" (mirror pola tabel batch di
// product-detail-client.tsx / stock-client.tsx ProductStockInTab). Sparepart
// flat (batchTracked=false) TETAP form lama (qty tunggal), gak ada tabel
// batch, gak ada below-cost check (backend emang gak ngecek itu buat
// sparepart, batch-tracked ataupun flat).
export interface Sparepart {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  sellPrice: string;
  stock: string;
  minStock: string;
  active: boolean;
  batchTracked: boolean;
  // Mode utuh/eceran (2026-09-30).
  trackingMode: SparepartMode;
  packUnit: string | null;
  packSize: string | null;
  sellPricePack: string | null;
}

export type StockInSparepart = Pick<
  Sparepart,
  'id' | 'name' | 'unit' | 'trackingMode' | 'packUnit' | 'packSize'
>;

interface SparepartBatch {
  id: string;
  supplierName: string | null;
  buyPrice: string;
  stock: string;
  createdAt: string;
}

interface StockInResult {
  status: 'ok' | 'confirm_required';
}

const flatStockInSchema = z.object({
  qty: requiredNumberField('Qty wajib diisi'),
  // Mode konversi: 'pack' = qty dalam satuan besar (dus/roll), 'unit' =
  // satuan kecil. Mode biasa: selalu 'unit' (select gak ditampilkan).
  qtyIn: z.enum(['unit', 'pack']),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  note: z.string().optional(),
});
type FlatStockInValues = z.infer<typeof flatStockInSchema>;
const flatStockInEmptyValues: FlatStockInValues = { qty: '', qtyIn: 'unit', buyPrice: '', note: '' };

const rollStockInSchema = z.object({
  rolls: z
    .array(z.object({ length: requiredNumberField('Panjang wajib diisi') }))
    .min(1, 'Minimal 1 gulungan'),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  supplierName: z.string().optional(),
  note: z.string().optional(),
});
type RollStockInValues = z.infer<typeof rollStockInSchema>;
const rollStockInEmptyValues: RollStockInValues = {
  rolls: [{ length: '' }],
  buyPrice: '',
  supplierName: '',
  note: '',
};

export function SparepartDetailClient({ sparepartId }: { sparepartId: string }) {
  const sparepartsQuery = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });
  const sparepart = sparepartsQuery.data?.find((s) => s.id === sparepartId);

  if (sparepartsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat sparepart...</p>;
  }
  if (sparepartsQuery.isError) {
    return <p className="text-sm text-destructive">Gagal memuat data sparepart.</p>;
  }
  if (!sparepart) {
    return <p className="text-sm text-destructive">Sparepart tidak ditemukan.</p>;
  }

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/master/sparepart"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Kembali ke daftar sparepart
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{sparepart.name}</h1>
          <Badge variant={sparepart.active ? 'success' : 'secondary'}>
            {sparepart.active ? 'Aktif' : 'Nonaktif'}
          </Badge>
          {sparepart.trackingMode !== 'biasa' && (
            <Badge variant="secondary">
              {sparepart.trackingMode === 'gulungan'
                ? 'Per Gulungan'
                : sparepart.trackingMode === 'konversi'
                  ? 'Utuh + Eceran'
                  : 'Gabungan'}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Stok saat ini: {formatStock(sparepart)}
          {hasPackSale(sparepart.trackingMode) &&
            sparepart.packSize &&
            Number(sparepart.stock) >= Number(sparepart.packSize) && (
              <span>
                {' '}
                ({sparepart.stock} {sparepart.unit})
              </span>
            )}{' '}
          • Harga jual:{' '}
          {hasPackSale(sparepart.trackingMode) && sparepart.sellPricePack
            ? `${formatRupiah(sparepart.sellPricePack)} / ${sparepart.packUnit} • ${formatRupiah(sparepart.sellPrice)} / ${sparepart.unit}`
            : formatRupiah(sparepart.sellPrice)}
        </p>
      </div>

      {sparepart.batchTracked ? (
        <BatchTrackedStockIn sparepart={sparepart} />
      ) : (
        <FlatStockIn sparepart={sparepart} />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sparepart FLAT — form lama, gak berubah.
// ----------------------------------------------------------------------------
function cap(v: string | null): string {
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
}

export function FlatStockIn({ sparepart }: { sparepart: StockInSparepart }) {
  const queryClient = useQueryClient();
  const isKonversi = sparepart.trackingMode === 'konversi' && !!sparepart.packSize;
  const packSize = isKonversi ? Number(sparepart.packSize) : 1;
  const stockInForm = useForm<FlatStockInValues>({
    resolver: zodResolver(flatStockInSchema),
    defaultValues: { ...flatStockInEmptyValues, qtyIn: isKonversi ? 'pack' : 'unit' },
  });
  const qtyIn = stockInForm.watch('qtyIn');
  const buyPriceWatch = Number(stockInForm.watch('buyPrice') || 0);

  const stockInMutation = useMutation({
    mutationFn: (values: FlatStockInValues) => {
      // Stok & modal SELALU disimpan per satuan kecil (backend) — konversi di
      // sini kalau admin input dalam satuan besar.
      const qty = Number(values.qty) * (isKonversi && values.qtyIn === 'pack' ? packSize : 1);
      const buyPrice = Number(values.buyPrice) / (isKonversi && values.qtyIn === 'pack' ? packSize : 1);
      return apiClient.post<StockInResult>('/stock/in', {
        kind: 'sparepart',
        refId: sparepart.id,
        qty: Math.round(qty * 100) / 100,
        buyPrice: Math.round(buyPrice * 100) / 100,
        note: trimmedOrUndefined(values.note),
      });
    },
    onSuccess: () => {
      toast.success('Barang masuk tersimpan.');
      stockInForm.reset({ ...flatStockInEmptyValues, qtyIn: isKonversi ? 'pack' : 'unit' });
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="text-base">Tambah Stok</CardTitle>
        <CardDescription>Catat kedatangan stok sparepart ini dari supplier.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...stockInForm}>
          <form
            onSubmit={stockInForm.handleSubmit((values) => stockInMutation.mutate(values))}
            className="grid gap-4"
          >
            {isKonversi && (
              <FormField
                control={stockInForm.control}
                name="qtyIn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Input dalam satuan</FormLabel>
                    <div className="flex gap-2">
                      {(['pack', 'unit'] as const).map((k) => (
                        <Button
                          key={k}
                          type="button"
                          size="sm"
                          variant={field.value === k ? 'default' : 'outline'}
                          onClick={() => field.onChange(k)}
                        >
                          {k === 'pack' ? `${sparepart.packUnit} (isi ${sparepart.packSize} ${sparepart.unit})` : sparepart.unit}
                        </Button>
                      ))}
                    </div>
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={stockInForm.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Qty Masuk ({isKonversi && qtyIn === 'pack' ? sparepart.packUnit : sparepart.unit})
                  </FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={stockInForm.control}
              name="buyPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Harga Modal{isKonversi ? ` (per ${qtyIn === 'pack' ? sparepart.packUnit : sparepart.unit})` : ''}
                  </FormLabel>
                  <FormControl>
                    <CurrencyInput {...field} />
                  </FormControl>
                  {isKonversi && qtyIn === 'pack' && buyPriceWatch > 0 && (
                    <p className="text-xs text-muted-foreground">
                      = {formatRupiah(Math.round((buyPriceWatch / packSize) * 100) / 100)} per {sparepart.unit}
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={stockInForm.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Catatan</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Opsional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={stockInMutation.isPending}>
              {stockInMutation.isPending ? 'Menyimpan...' : 'Simpan Barang Masuk'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Sparepart BATCH-TRACKED (Siklus sparepart-per-gulungan 2026-09-23) — form
// jumlah gulungan + panjang per gulungan (dinamis, react-hook-form
// useFieldArray, pola sama kayak form multi-baris lain di app ini), SATU
// harga modal buat semua gulungan di 1 nota barang masuk. Tabel "Gulungan
// Aktif" di bawah mirip tabel batch produk (stock-client.tsx
// ProductStockInTab) — dari endpoint baru GET /spareparts/:id/batches.
// ----------------------------------------------------------------------------
export function BatchTrackedStockIn({
  sparepart,
  showBatches = true,
}: {
  sparepart: StockInSparepart;
  showBatches?: boolean;
}) {
  const queryClient = useQueryClient();

  const batchesQuery = useQuery({
    queryKey: ['sparepart-batches', sparepart.id],
    queryFn: () => apiClient.get<SparepartBatch[]>(`/spareparts/${sparepart.id}/batches`),
  });

  const form = useForm<RollStockInValues>({
    resolver: zodResolver(rollStockInSchema),
    defaultValues: rollStockInEmptyValues,
  });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: 'rolls' });

  // Mode 'gabungan' (2026-09-30): 1 roll/tabung "penuh" = packSize. Modal
  // diinput per satuan besar (natural: beli 1 roll Rp900rb), dikonversi ke
  // per satuan kecil sebelum dikirim (backend nyimpen modal per satuan kecil).
  const isGabungan = sparepart.trackingMode === 'gabungan' && !!sparepart.packSize;
  const packSize = isGabungan ? Number(sparepart.packSize) : 0;
  const [quickCount, setQuickCount] = React.useState('1');
  const buyPriceWatch = Number(form.watch('buyPrice') || 0);

  function addFullPacks() {
    const n = Math.floor(Number(quickCount));
    if (!(n >= 1) || n > 200) {
      toast.error('Jumlah harus antara 1 sampai 200.');
      return;
    }
    const current = form.getValues('rolls').filter((r) => r.length.trim() !== '');
    replace([...current, ...Array.from({ length: n }, () => ({ length: String(packSize) }))]);
  }

  const stockInMutation = useMutation({
    mutationFn: (values: RollStockInValues) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'sparepart',
        refId: sparepart.id,
        rolls: values.rolls.map((r) => ({ length: Number(r.length) })),
        buyPrice: isGabungan
          ? Math.round((Number(values.buyPrice) / packSize) * 100) / 100
          : Number(values.buyPrice),
        supplierName: trimmedOrUndefined(values.supplierName),
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: () => {
      toast.success('Barang masuk tersimpan.');
      form.reset(rollStockInEmptyValues);
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
      queryClient.invalidateQueries({ queryKey: ['sparepart-batches', sparepart.id] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  return (
    <div className={showBatches ? 'grid gap-6 lg:grid-cols-2' : 'grid gap-6'}>
      {showBatches && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isGabungan ? `${cap(sparepart.packUnit)} Aktif` : 'Gulungan Aktif'}
          </CardTitle>
          <CardDescription>
            {isGabungan
              ? `Sisa tiap ${sparepart.packUnit} yang masih berstok. "Utuh" = masih penuh (${sparepart.packSize} ${sparepart.unit}), bisa dijual utuh.`
              : 'Sisa panjang tiap gulungan yang masih berstok.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {batchesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Memuat gulungan...</p>
          ) : !batchesQuery.data || batchesQuery.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada gulungan aktif — sparepart ini belum punya stok.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Modal / {sparepart.unit}</TableHead>
                    <TableHead>Sisa ({sparepart.unit})</TableHead>
                    {isGabungan && <TableHead>Status</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchesQuery.data.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-muted-foreground">{formatDate(b.createdAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{b.supplierName || '-'}</TableCell>
                      <TableCell>{formatRupiah(b.buyPrice)}</TableCell>
                      <TableCell>{b.stock}</TableCell>
                      {isGabungan && (
                        <TableCell>
                          {Number(b.stock) === packSize ? (
                            <Badge variant="success">Utuh</Badge>
                          ) : (
                            <Badge variant="secondary">Terbuka</Badge>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isGabungan ? `Tambah ${cap(sparepart.packUnit)} Baru` : 'Tambah Gulungan Baru'}
          </CardTitle>
          <CardDescription>
            {isGabungan
              ? `Isi ${sparepart.unit} tiap ${sparepart.packUnit} yang datang (kalau kurang dari ${sparepart.packSize} ${sparepart.unit}, hanya bisa dijual eceran). Satu harga modal berlaku buat semua ${sparepart.packUnit} di nota ini.`
              : 'Isi panjang tiap gulungan yang datang — boleh beda-beda. Satu harga modal berlaku buat semua gulungan di nota ini.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => stockInMutation.mutate(values))}
              className="grid gap-4"
            >
              <div className="grid gap-2">
                {isGabungan && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
                    <Input
                      className="w-20"
                      inputMode="numeric"
                      value={quickCount}
                      onChange={(e) => setQuickCount(e.target.value)}
                    />
                    <span className="text-sm">
                      {sparepart.packUnit} penuh (@ {sparepart.packSize} {sparepart.unit})
                    </span>
                    <Button type="button" size="sm" variant="secondary" onClick={addFullPacks}>
                      Tambah
                    </Button>
                  </div>
                )}
                <FormLabel>
                  {isGabungan ? `Daftar ${sparepart.packUnit}` : 'Gulungan'} ({sparepart.unit})
                </FormLabel>
                {fields.map((field, idx) => (
                  <div key={field.id} className="flex items-center gap-2">
                    <FormField
                      control={form.control}
                      name={`rolls.${idx}.length`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input inputMode="decimal" placeholder={`${isGabungan ? `Isi ${sparepart.packUnit}` : 'Panjang gulungan'} #${idx + 1}`} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={fields.length === 1}
                      onClick={() => remove(idx)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => append({ length: '' })}
                >
                  <Plus className="size-4" />
                  {isGabungan ? `Tambah ${sparepart.packUnit} (isi custom)` : 'Tambah Gulungan'}
                </Button>
              </div>
              <FormField
                control={form.control}
                name="buyPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Harga Modal (per {isGabungan ? sparepart.packUnit : sparepart.unit}, berlaku
                      semua gulungan)
                    </FormLabel>
                    <FormControl>
                      <CurrencyInput {...field} />
                    </FormControl>
                    {isGabungan && buyPriceWatch > 0 && (
                      <p className="text-xs text-muted-foreground">
                        = {formatRupiah(Math.round((buyPriceWatch / packSize) * 100) / 100)} per{' '}
                        {sparepart.unit}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="supplierName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier</FormLabel>
                    <FormControl>
                      <Input placeholder="Opsional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Catatan</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Opsional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={stockInMutation.isPending}>
                {stockInMutation.isPending ? 'Menyimpan...' : 'Simpan Barang Masuk'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
