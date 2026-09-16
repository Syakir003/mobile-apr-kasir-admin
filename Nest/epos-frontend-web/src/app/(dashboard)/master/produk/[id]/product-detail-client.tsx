'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';

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
// dari tabel Master > Produk klik barisnya, langsung ke sini. Sama logic-nya
// kayak dialog batch yang lama, cuma layout-nya dipindah ke halaman sendiri.
interface Product {
  id: string;
  name: string;
  brand: string | null;
  stock: number;
  sellPriceMin: number | null;
  sellPriceMax: number | null;
}

interface ProductBatch {
  id: string;
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
interface StockInResult {
  status: 'ok' | 'confirm_required';
  warnings?: StockInWarning[];
}

const batchInSchema = z.object({
  qty: requiredNumberField('Qty wajib diisi').refine(
    (v) => Number.isInteger(Number(v)),
    'Qty produk harus bilangan bulat',
  ),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  sellPrice: requiredNumberField('Harga jual wajib diisi'),
  supplierName: z.string().optional(),
  note: z.string().optional(),
});
type BatchInValues = z.infer<typeof batchInSchema>;
const batchInEmptyValues: BatchInValues = {
  qty: '',
  buyPrice: '',
  sellPrice: '',
  supplierName: '',
  note: '',
};

export function ProductDetailClient({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const [pendingWarning, setPendingWarning] = React.useState<StockInWarning | null>(null);

  const productQuery = useQuery({
    queryKey: ['products', productId],
    queryFn: () => apiClient.get<Product>(`/products/${productId}`),
  });

  const batchesQuery = useQuery({
    queryKey: ['product-batches', productId],
    queryFn: () => apiClient.get<ProductBatch[]>(`/products/${productId}/batches`),
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
        buyPrice: Number(values.buyPrice),
        sellPrice: Number(values.sellPrice),
        supplierName: trimmedOrUndefined(values.supplierName),
        note: trimmedOrUndefined(values.note),
        confirmOverride: values.confirmOverride,
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
      setPendingWarning(null);
      batchInForm.reset(batchInEmptyValues);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products', productId] });
      queryClient.invalidateQueries({ queryKey: ['product-batches', productId] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  function onSubmitBatchIn(values: BatchInValues) {
    batchInMutation.mutate(values);
  }

  function confirmBatchInOverride() {
    batchInMutation.mutate({ ...batchInForm.getValues(), confirmOverride: true });
  }

  if (productQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat produk...</p>;
  }
  if (productQuery.isError || !productQuery.data) {
    return <p className="text-sm text-destructive">Gagal memuat data produk.</p>;
  }
  const product = productQuery.data;

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
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          {product.stock > 0 ? (
            <Badge variant="success">{product.stock} unit</Badge>
          ) : (
            <Badge variant="warning">Belum ada stok</Badge>
          )}
        </div>
        {product.brand && <p className="mt-1 text-sm text-muted-foreground">{product.brand}</p>}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Batch Aktif</CardTitle>
            <CardDescription>
              Daftar batch aktif (stok &gt; 0). Tiap batch punya harga modal & jual sendiri.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {batchesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Memuat batch...</p>
            ) : !batchesQuery.data || batchesQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada batch aktif — produk ini belum punya stok/harga jual. Isi form di kanan
                buat mulai.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Modal</TableHead>
                      <TableHead>Jual</TableHead>
                      <TableHead>Stok</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchesQuery.data.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="text-muted-foreground">
                          {formatDate(b.createdAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {b.supplierName || '-'}
                        </TableCell>
                        <TableCell>{formatRupiah(b.buyPrice)}</TableCell>
                        <TableCell>{formatRupiah(b.sellPrice)}</TableCell>
                        <TableCell>{b.stock}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tambah Batch Baru</CardTitle>
            <CardDescription>Catat kedatangan stok produk ini dari supplier.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...batchInForm}>
              <form onSubmit={batchInForm.handleSubmit(onSubmitBatchIn)} className="grid gap-4">
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
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={batchInForm.control}
                    name="buyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Harga Modal</FormLabel>
                        <FormControl>
                          <CurrencyInput {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={batchInForm.control}
                    name="sellPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Harga Jual</FormLabel>
                        <FormControl>
                          <CurrencyInput {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
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
