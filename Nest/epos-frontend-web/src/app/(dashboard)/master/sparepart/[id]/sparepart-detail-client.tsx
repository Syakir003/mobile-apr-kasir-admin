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
import { formatRupiah } from '@/lib/format';
import { requiredNumberField, trimmedOrUndefined } from '@/lib/form-number';
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

// Halaman detail sparepart — pasangan product-detail-client.tsx, dibikin
// per keputusan 2026-09-15 (halaman penuh, bukan dialog popup). Beda sama
// Produk: gak ada endpoint GET /spareparts/:id di backend (SparepartsController
// cuma punya findAll/search/create/update), jadi datanya diambil dari list
// /spareparts terus dicari by id di sini — sama kayak pola lama yang dipakai
// dialog "Stok" sebelumnya.
//
// Barang masuk sparepart cuma nambah qty + catat harga modal (item_costs,
// buat HPP di Laporan) — harga jual & stok yang keliatan di POS/servis tetap
// kolom langsung di tabel spareparts (StockLockingService.lockAndAdd). Gak
// ada konsep batch/harga-jual-per-batch kayak Produk, jadi gak ada below-cost
// check / dialog konfirmasi di sini (backend emang gak ngecek itu buat
// kind='sparepart').
interface Sparepart {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  sellPrice: string;
  stock: string;
  minStock: string;
  active: boolean;
}

interface StockInResult {
  status: 'ok' | 'confirm_required';
}

const stockInSchema = z.object({
  qty: requiredNumberField('Qty wajib diisi'),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  note: z.string().optional(),
});
type StockInValues = z.infer<typeof stockInSchema>;
const stockInEmptyValues: StockInValues = { qty: '', buyPrice: '', note: '' };

export function SparepartDetailClient({ sparepartId }: { sparepartId: string }) {
  const queryClient = useQueryClient();

  const sparepartsQuery = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });
  const sparepart = sparepartsQuery.data?.find((s) => s.id === sparepartId);

  const stockInForm = useForm<StockInValues>({
    resolver: zodResolver(stockInSchema),
    defaultValues: stockInEmptyValues,
  });

  const stockInMutation = useMutation({
    mutationFn: (values: StockInValues) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'sparepart',
        refId: sparepartId,
        qty: Number(values.qty),
        buyPrice: Number(values.buyPrice),
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: () => {
      toast.success('Barang masuk tersimpan.');
      stockInForm.reset(stockInEmptyValues);
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  function onSubmitStockIn(values: StockInValues) {
    stockInMutation.mutate(values);
  }

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
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Stok saat ini: {sparepart.stock} {sparepart.unit} • Harga jual:{' '}
          {formatRupiah(sparepart.sellPrice)}
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Tambah Stok</CardTitle>
          <CardDescription>Catat kedatangan stok sparepart ini dari supplier.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...stockInForm}>
            <form onSubmit={stockInForm.handleSubmit(onSubmitStockIn)} className="grid gap-4">
              <FormField
                control={stockInForm.control}
                name="qty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Qty Masuk ({sparepart.unit})</FormLabel>
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
                    <FormLabel>Harga Modal</FormLabel>
                    <FormControl>
                      <CurrencyInput {...field} />
                    </FormControl>
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
    </div>
  );
}
