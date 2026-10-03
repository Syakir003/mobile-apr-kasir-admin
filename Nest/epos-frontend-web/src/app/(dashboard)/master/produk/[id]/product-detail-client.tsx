'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, QrCode } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate, formatRupiah } from '@/lib/format';
import { requiredNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

// Halaman detail produk — GABUNGAN "lihat batch" + "barang masuk" jadi
// satu halaman penuh (bukan dialog popup lagi), per keputusan 2026-09-15:
// dari tabel Master > Produk klik barisnya, langsung ke sini.
//
// Paket AC Split (2026-09-30) — produk Indoor yang punya pasangan Outdoor
// diperlakukan sebagai 1 PAKET: batch ditampilin per barang masuk paket
// (stok & QR per unit Indoor/Outdoor), dan form barang masuk jadi 1 modal
// paket + jumlah Indoor & Outdoor (boleh beda). Halaman Outdoor sebuah paket
// nunjuk balik ke paketnya; form di situ = restock Outdoor SAJA (modal
// sendiri). Lihat spec specs/2026-09-30-paket-ac-split-design.md.
interface Product {
  id: string;
  name: string;
  brand: string | null;
  stock: number;
  sellPrice: string;
  acRole: 'indoor' | 'outdoor' | null;
  pairedProductId: string | null;
  pairedProduct: { id: string; name: string } | null;
  // Indoor yang masangin produk ini (kalau produk ini Outdoor sebuah paket).
  pairedWithMe?: { id: string; name: string }[];
}

interface ProductBatch {
  id: string;
  refId: string;
  unitName: string;
  unitRole: 'indoor' | 'outdoor' | null;
  pairGroupId: string | null;
  supplierName: string | null;
  buyPrice: string;
  sellPrice: string;
  stock: number;
  createdAt: string;
}

// Bentuk respons POST /stock/in — HTTP 200 walaupun butuh konfirmasi
// (below-cost), bukan error.
interface StockInWarning {
  refId: string;
  itemCostId: string | null;
  name: string;
  buyPrice: number;
  sellPrice: number;
  discount: number;
  effectivePrice: number;
}
// `batchId`/`qty`/`name` dipakai buat tombol "Cetak Label" di toast sukses
// (tiap unit fisik yang baru masuk punya QR sendiri, StockUnit). Mode paket
// juga balikin `outdoorBatchId`/`outdoorQty`/`outdoorName`.
interface StockInResult {
  status: 'ok' | 'confirm_required';
  warnings?: StockInWarning[];
  batchId?: string;
  qty?: number;
  name?: string;
  outdoorBatchId?: string | null;
  outdoorQty?: number;
  outdoorName?: string;
}

const intField = (label: string, min: number) =>
  requiredNumberField(`${label} wajib diisi`).refine(
    (v) => Number.isInteger(Number(v)) && Number(v) >= min,
    min === 0 ? `${label} harus bilangan bulat (boleh 0)` : `${label} harus bilangan bulat, minimal ${min}`,
  );

const batchInSchema = z.object({
  // Min 0 di schema: mode paket boleh Indoor 0 (kiriman Outdoor doang).
  // Minimal 1 buat produk biasa + "Indoor/Outdoor minimal salah satu" buat
  // paket dicek manual di onSubmitBatchIn.
  qty: intField('Qty', 0),
  // Cuma dipakai mode paket (Qty di atas = jumlah Indoor). Mode tunggal
  // ngabaikan field ini.
  outdoorQty: z.string().optional(),
  // Wajib-tidaknya dicek manual di onSubmitBatchIn (boleh kosong kalau
  // kiriman paket cuma Outdoor).
  buyPrice: z.string().refine((v) => v.trim() === '' || !Number.isNaN(Number(v)), 'Harus berupa angka'),
  supplierName: z.string().optional(),
  note: z.string().optional(),
});
type BatchInValues = z.infer<typeof batchInSchema>;
const batchInEmptyValues: BatchInValues = {
  qty: '',
  outdoorQty: '',
  buyPrice: '',
  supplierName: '',
  note: '',
};

/** Kelompokin batch per barang masuk paket (`pairGroupId` sama = 1 barang
 * masuk Indoor + Outdoor). Batch tanpa pairGroupId = kelompok sendiri. */
function groupBatches(batches: ProductBatch[]): ProductBatch[][] {
  const groups: ProductBatch[][] = [];
  const byGroupId = new Map<string, ProductBatch[]>();
  for (const b of batches) {
    if (!b.pairGroupId) {
      groups.push([b]);
      continue;
    }
    const existing = byGroupId.get(b.pairGroupId);
    if (existing) {
      existing.push(b);
    } else {
      const g = [b];
      byGroupId.set(b.pairGroupId, g);
      groups.push(g);
    }
  }
  return groups;
}

function roleLabel(role: ProductBatch['unitRole']): string {
  return role === 'indoor' ? 'Indoor' : role === 'outdoor' ? 'Outdoor' : 'Unit';
}

export function ProductDetailClient({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [pendingWarning, setPendingWarning] = React.useState<StockInWarning | null>(null);

  const productQuery = useQuery({
    queryKey: ['products', productId],
    queryFn: () => apiClient.get<Product>(`/products/${productId}`),
  });
  const product = productQuery.data;
  const isPackage = !!product?.pairedProductId;
  const packageIndoor = product?.pairedWithMe?.[0] ?? null;

  // Stok Outdoor pasangan (buat badge header paket).
  const outdoorQuery = useQuery({
    queryKey: ['products', product?.pairedProductId],
    queryFn: () => apiClient.get<Product>(`/products/${product!.pairedProductId}`),
    enabled: !!product?.pairedProductId,
  });

  const batchesQuery = useQuery({
    queryKey: ['product-batches', productId],
    queryFn: () => apiClient.get<ProductBatch[]>(`/products/${productId}/batches?includePair=1`),
  });

  const batchInForm = useForm<BatchInValues>({
    resolver: zodResolver(batchInSchema),
    defaultValues: batchInEmptyValues,
  });

  const batchInMutation = useMutation({
    mutationFn: (values: BatchInValues & { confirmOverride?: boolean }) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'product',
        refId: productId,
        qty: Number(values.qty),
        buyPrice: Number(values.buyPrice || 0),
        supplierName: trimmedOrUndefined(values.supplierName),
        note: trimmedOrUndefined(values.note),
        confirmOverride: values.confirmOverride,
        ...(isPackage && product?.pairedProductId
          ? {
              pairMode: 'lengkap' as const,
              outdoorRefId: product.pairedProductId,
              outdoorQty: Number(values.outdoorQty || 0),
            }
          : {}),
      }),
    onSuccess: (result) => {
      if (result.status === 'confirm_required') {
        // Backend belum nyimpen apa-apa, nunggu admin confirm dulu lewat
        // dialog di bawah. Nilai form tetap kepegang lewat getValues() pas
        // admin klik "Tetap Simpan".
        setPendingWarning(result.warnings![0]);
        return;
      }
      toast.success('Barang masuk tersimpan.');
      // Tiap unit fisik yang baru masuk udah punya QR (StockUnit) yang perlu
      // ditempel ke dus/unitnya. Link permanennya ada di tabel batch juga.
      if (result.batchId) {
        toast.success(`${result.qty} unit ${result.name} siap dicetak labelnya`, {
          description: 'Cetak lalu tempel di kardus tiap unit, supaya bisa discan saat keluar gudang.',
          duration: 20000,
          action: {
            label: 'Cetak Label',
            onClick: () => router.push(`/stock/batches/${result.batchId}/print-labels`),
          },
        });
      }
      if (result.outdoorBatchId) {
        toast.success(`${result.outdoorQty} unit ${result.outdoorName} siap dicetak labelnya`, {
          description: 'Cetak lalu tempel di kardus tiap unit, supaya bisa discan saat keluar gudang.',
          duration: 20000,
          action: {
            label: 'Cetak Label',
            onClick: () => router.push(`/stock/batches/${result.outdoorBatchId}/print-labels`),
          },
        });
      }
      setPendingWarning(null);
      batchInForm.reset(batchInEmptyValues);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-batches'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  function onSubmitBatchIn(values: BatchInValues) {
    const indoorQty = Number(values.qty);
    if (isPackage) {
      const outdoorQty = Number(values.outdoorQty || 0);
      if (!Number.isInteger(outdoorQty) || outdoorQty < 0) {
        batchInForm.setError('outdoorQty', { message: 'Qty Outdoor harus bilangan bulat (boleh 0)' });
        return;
      }
      if (indoorQty + outdoorQty <= 0) {
        batchInForm.setError('qty', { message: 'Isi jumlah Indoor atau Outdoor (minimal salah satu)' });
        return;
      }
    } else if (indoorQty < 1) {
      batchInForm.setError('qty', { message: 'Qty harus bilangan bulat, minimal 1' });
      return;
    }
    // Modal wajib kalau ada Indoor / produk biasa. Kiriman Outdoor doang
    // (Indoor 0) boleh tanpa modal — modal paket tetap ngikut batch Indoor.
    if ((!isPackage || indoorQty > 0) && values.buyPrice.trim() === '') {
      batchInForm.setError('buyPrice', { message: 'Harga modal wajib diisi' });
      return;
    }
    batchInMutation.mutate(values);
  }

  function confirmBatchInOverride() {
    batchInMutation.mutate({ ...batchInForm.getValues(), confirmOverride: true });
  }

  if (productQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat produk...</p>;
  }
  if (productQuery.isError || !product) {
    return <p className="text-sm text-destructive">Gagal memuat data produk.</p>;
  }

  const outdoor = outdoorQuery.data;
  const batchGroups = groupBatches(batchesQuery.data ?? []);

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/master/produk"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Kembali ke daftar produk
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isPackage && product.pairedProduct
              ? `${product.name} + ${product.pairedProduct.name}`
              : product.name}
          </h1>
          {isPackage ? (
            <>
              <Badge variant={product.stock > 0 ? 'success' : 'warning'}>
                Indoor: {product.stock} unit
              </Badge>
              <Badge variant={(outdoor?.stock ?? 0) > 0 ? 'success' : 'warning'}>
                Outdoor: {outdoor ? `${outdoor.stock} unit` : '...'}
              </Badge>
              <Badge variant="secondary">Harga Paket (Split): {formatRupiah(product.sellPrice)}</Badge>
            </>
          ) : (
            <>
              {product.stock > 0 ? (
                <Badge variant="success">{product.stock} unit</Badge>
              ) : (
                <Badge variant="warning">Belum ada stok</Badge>
              )}
              {/* Outdoor sebuah paket: dijual sepaket (harga paket di
                  Indoor-nya) atau satuan (harga diisi kasir), jadi
                  sellPrice-nya sendiri gak relevan buat ditampilin. */}
              {packageIndoor ? (
                <Badge variant="secondary">Harga satuan: diisi kasir saat dijual</Badge>
              ) : (
                <Badge variant="secondary">Harga Jual: {formatRupiah(product.sellPrice)}</Badge>
              )}
              {product.acRole && (
                <Badge variant="outline">{product.acRole === 'indoor' ? 'Indoor' : 'Outdoor'}</Badge>
              )}
            </>
          )}
        </div>
        {product.brand && <p className="mt-1 text-sm text-muted-foreground">{product.brand}</p>}
        {isPackage && product.pairedProduct && (
          <p className="mt-1 text-sm text-muted-foreground">
            1 Produk AC = paket Unit Indoor ({product.name}) + Unit Outdoor (
            <Link href={`/master/produk/${product.pairedProduct.id}`} className="underline">
              {product.pairedProduct.name}
            </Link>
            ). Tiap unit punya stok & QR sendiri.
          </p>
        )}
        {packageIndoor && (
          <p className="mt-1 text-sm text-muted-foreground">
            Unit ini Outdoor dari paket{' '}
            <Link href={`/master/produk/${packageIndoor.id}`} className="font-medium underline">
              {packageIndoor.name}
            </Link>
            . Semua barang masuk (Indoor + Outdoor, termasuk Outdoor susulan) dicatat di halaman paket
            itu.
          </p>
        )}
      </div>

      <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Batch Aktif</CardTitle>
            <CardDescription>
              {isPackage || packageIndoor
                ? 'Stok per unit dari tiap barang masuk. Barang masuk paket nampil sekelompok (Indoor & Outdoor), modalnya 1 angka per paket. Tiap unit punya QR sendiri buat stok gudang.'
                : 'Daftar batch aktif (stok > 0). Tiap batch punya harga modal sendiri — harga jual udah seragam (lihat badge di atas), diatur lewat Master Data Produk.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {batchesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Memuat batch...</p>
            ) : batchGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada batch aktif — produk ini belum punya stok. Isi form di kanan buat mulai.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Modal</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Stok</TableHead>
                      <TableHead className="text-right">Label QR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchGroups.map((group) => {
                      const isPackageGroup = !!group[0].pairGroupId;
                      // Modal paket nempel di batch Indoor (Outdoor Rp0).
                      const modalBatch = group.find((b) => b.unitRole === 'indoor') ?? group[0];
                      return group.map((b, i) => (
                        <TableRow key={b.id}>
                          {i === 0 && (
                            <>
                              <TableCell className="align-top text-muted-foreground" rowSpan={group.length}>
                                {formatDate(b.createdAt)}
                              </TableCell>
                              <TableCell className="align-top text-muted-foreground" rowSpan={group.length}>
                                {b.supplierName || '-'}
                              </TableCell>
                              <TableCell className="align-top" rowSpan={group.length}>
                                {isPackageGroup && !group.some((x) => x.unitRole === 'indoor')
                                  ? '-'
                                  : formatRupiah(modalBatch.buyPrice)}
                                {isPackageGroup && (
                                  <p className="text-xs text-muted-foreground">per paket</p>
                                )}
                              </TableCell>
                            </>
                          )}
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{roleLabel(b.unitRole)}</Badge>
                              <span className="text-sm">{b.unitName}</span>
                            </div>
                          </TableCell>
                          <TableCell>{b.stock}</TableCell>
                          <TableCell className="text-right">
                            {/* Link PERMANEN (Siklus QR per-unit), gak cuma
                                toast sesaat pas barang masuk. */}
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/stock/batches/${b.id}/print-labels`}>
                                <QrCode className="size-4" />
                                Lihat/Cetak
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ));
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {!isPackage && packageIndoor ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Restock Outdoor</CardTitle>
              <CardDescription>
                Outdoor ini bagian dari paket, jadi gak punya modal sendiri. Semua barang masuk (termasuk
                kiriman Outdoor susulan) dicatat lewat halaman paket — isi Jumlah Indoor 0 kalau cuma
                Outdoor yang datang.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/master/produk/${packageIndoor.id}`}>Restock lewat halaman paket</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isPackage ? 'Barang Masuk Paket' : 'Tambah Batch Baru'}
            </CardTitle>
            <CardDescription>
              {isPackage
                ? 'Catat kedatangan paket AC dari supplier. Modal diisi 1 angka per paket (Indoor + Outdoor); jumlah tiap unit boleh beda.'
                : 'Catat kedatangan stok produk ini dari supplier.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...batchInForm}>
              <form onSubmit={batchInForm.handleSubmit(onSubmitBatchIn)} className="grid gap-4">
                <FormField
                  control={batchInForm.control}
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
                  control={batchInForm.control}
                  name="buyPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isPackage ? 'Modal Paket (Indoor + Outdoor)' : 'Harga Modal'}</FormLabel>
                      <FormControl>
                        <CurrencyInput {...field} />
                      </FormControl>
                      {isPackage && (
                        <p className="text-xs text-muted-foreground">
                          Kosongkan kalau cuma Outdoor susulan yang datang (Jumlah Indoor 0).
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {isPackage ? (
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={batchInForm.control}
                      name="qty"
                      render={({ field }) => (
                        <FormItem className="rounded-md border border-dashed p-3">
                          <FormLabel>Jumlah Indoor</FormLabel>
                          <p className="truncate text-xs text-muted-foreground">{product.name}</p>
                          <FormControl>
                            <Input inputMode="numeric" placeholder="0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={batchInForm.control}
                      name="outdoorQty"
                      render={({ field }) => (
                        <FormItem className="rounded-md border border-dashed p-3">
                          <FormLabel>Jumlah Outdoor</FormLabel>
                          <p className="truncate text-xs text-muted-foreground">
                            {product.pairedProduct?.name}
                          </p>
                          <FormControl>
                            <Input inputMode="numeric" placeholder="0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ) : (
                  <FormField
                    control={batchInForm.control}
                    name="qty"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Qty Masuk</FormLabel>
                        <FormControl>
                          <Input inputMode="numeric" placeholder="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={batchInForm.control}
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
                <Button type="submit" disabled={batchInMutation.isPending}>
                  {batchInMutation.isPending ? 'Menyimpan...' : 'Simpan Barang Masuk'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        )}
      </div>

      <Dialog open={!!pendingWarning} onOpenChange={(open) => !open && setPendingWarning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Harga jual di bawah/pas modal</DialogTitle>
            <DialogDescription>
              Batch ini bakal disimpan dengan harga jual yang gak untung (atau pas-pasan modal).
              Cek lagi sebelum lanjut.
            </DialogDescription>
          </DialogHeader>
          {pendingWarning && (
            <div className="grid gap-1 rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between py-0.5 text-muted-foreground">
                <span>Harga Modal</span>
                <span className="text-foreground">{formatRupiah(pendingWarning.buyPrice)}</span>
              </div>
              <div className="flex items-center justify-between py-0.5 text-muted-foreground">
                <span>Harga Jual</span>
                <span className="text-foreground">{formatRupiah(pendingWarning.sellPrice)}</span>
              </div>
              <div className="flex items-center justify-between py-0.5 text-muted-foreground">
                <span>Harga Efektif</span>
                <span className="text-foreground">
                  {formatRupiah(pendingWarning.effectivePrice)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t pt-1 font-medium text-destructive">
                <span>Rugi per Unit</span>
                <span>
                  {formatRupiah(pendingWarning.buyPrice - pendingWarning.effectivePrice)}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingWarning(null)}
              disabled={batchInMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={confirmBatchInOverride}
              disabled={batchInMutation.isPending}
            >
              {batchInMutation.isPending ? 'Menyimpan...' : 'Tetap Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
