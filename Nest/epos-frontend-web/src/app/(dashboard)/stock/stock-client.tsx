'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Search } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah, formatDate } from '@/lib/format';
import { requiredNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

// Halaman "Barang Masuk" (Siklus batch-cost 2026-09) — SATU-SATUNYA jalan
// ngasih stok+harga ke produk baru (POST /products udah gak nerima
// sellPrice/stock lagi, lihat CreateProductDto). Sparepart beda: stok/harga
// jual sparepart tetap kolom langsung di tabel spareparts (diisi pas create
// di halaman Master > Sparepart), endpoint /stock/in cuma nambah kuantitas +
// nyatet harga modal (item_costs) — TAPI tetap lewat sini biar histori
// StockMovement-nya konsisten (bukan mutasi manual kayak form Sparepart).
//
// 2 tab BENERAN terpisah (bukan 1 form + toggle kind) — state, schema,
// query, mutation masing-masing sendiri, gak ada yang di-share selain
// komponen presentasional ItemSearchPicker di bawah.

interface Product {
  id: string;
  name: string;
  brand: string | null;
  // Agregat dari ProductsService.priceAggFor (SUM/MIN/MAX item_costs
  // kind='product', stock>0) — BUKAN kolom langsung di tabel products lagi.
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

interface Sparepart {
  id: string;
  name: string;
  unit: string;
  sellPrice: string;
  stock: string;
}

interface StockInWarning {
  refId: string;
  itemCostId: string | null;
  name: string;
  buyPrice: number;
  sellPrice: number;
  discount: number;
  effectivePrice: number;
}

// Field lain di respons sukses (movementId/batchId/newStock/dst) gak
// dibutuhin di UI — cuma status yang nentuin alur (langsung sukses vs perlu
// konfirmasi below-cost dulu).
interface StockInResult {
  status: 'ok' | 'confirm_required';
  warnings?: StockInWarning[];
}

export function StockClient() {
  // Dipakai tombol "Tambah Batch Baru" di dialog batch halaman Produk
  // (/stock?product=<id>) — biar admin langsung nyambung ke produk yang
  // tadi dilihat, gak perlu cari ulang di picker. Butuh Suspense boundary
  // di page.tsx (aturan App Router buat useSearchParams), lihat pola sama
  // di app/(auth)/login/page.tsx.
  const searchParams = useSearchParams();
  const initialProductId = searchParams.get('product') ?? undefined;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Barang Masuk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Catat kedatangan stok. Produk baru gak akan punya harga/stok di POS sampai
          di-input di sini.
        </p>
      </div>

      <Tabs defaultValue="product">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="product">Produk</TabsTrigger>
          <TabsTrigger value="sparepart">Sparepart</TabsTrigger>
        </TabsList>
        <TabsContent value="product" className="mt-4">
          <ProductStockInTab initialProductId={initialProductId} />
        </TabsContent>
        <TabsContent value="sparepart" className="mt-4">
          <SparepartStockInTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tab Produk — tiap barang masuk SELALU bikin batch (ItemCost) baru, jadi
// satu produk bisa punya banyak harga jual aktif sekaligus. Nampilin batch
// yang udah ada dulu biar admin sadar itu sebelum nambah batch baru lagi.
// ----------------------------------------------------------------------------

const productStockInSchema = z.object({
  qty: requiredNumberField('Qty wajib diisi').refine(
    (v) => Number.isInteger(Number(v)),
    'Qty produk harus bilangan bulat',
  ),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  sellPrice: requiredNumberField('Harga jual wajib diisi'),
  supplierName: z.string().optional(),
  note: z.string().optional(),
});
type ProductStockInValues = z.infer<typeof productStockInSchema>;

const productStockInEmptyValues: ProductStockInValues = {
  qty: '',
  buyPrice: '',
  sellPrice: '',
  supplierName: '',
  note: '',
};

function ProductStockInTab({ initialProductId }: { initialProductId?: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Product | null>(null);
  // Ditaruh di state (bukan langsung dikirim ulang dari dalam onSuccess)
  // biar dialog konfirmasi bisa dipisah dari respons awal — nilai form yang
  // udah di-submit tetap kepegang lewat form.getValues() pas admin klik
  // "Tetap Simpan".
  const [pendingWarning, setPendingWarning] = React.useState<StockInWarning | null>(null);

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => apiClient.get<Product[]>('/products'),
  });

  const batchesQuery = useQuery({
    queryKey: ['product-batches', selected?.id],
    queryFn: () => apiClient.get<ProductBatch[]>(`/products/${selected!.id}/batches`),
    enabled: !!selected,
  });

  const form = useForm<ProductStockInValues>({
    resolver: zodResolver(productStockInSchema),
    defaultValues: productStockInEmptyValues,
  });

  function selectProduct(p: Product) {
    setSelected(p);
    setPendingWarning(null);
    form.reset(productStockInEmptyValues);
  }

  // Auto-select produk dari ?product=<id> begitu daftar produk kebaca —
  // cuma sekali (dijaga lewat `selected` di deps, begitu user ganti pilihan
  // manual gak ke-override lagi walau query param masih nempel di URL).
  React.useEffect(() => {
    if (selected || !initialProductId || !productsQuery.data) return;
    const match = productsQuery.data.find((p) => p.id === initialProductId);
    if (match) selectProduct(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProductId, productsQuery.data, selected]);

  const stockInMutation = useMutation({
    mutationFn: (values: ProductStockInValues & { confirmOverride?: boolean }) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'product',
        refId: selected!.id,
        qty: Number(values.qty),
        buyPrice: Number(values.buyPrice),
        sellPrice: Number(values.sellPrice),
        supplierName: trimmedOrUndefined(values.supplierName),
        note: trimmedOrUndefined(values.note),
        confirmOverride: values.confirmOverride,
      }),
    onSuccess: (result) => {
      if (result.status === 'confirm_required') {
        // HTTP 200, bukan error — backend belum nyimpen apa-apa, nunggu
        // admin confirm dulu lewat dialog di bawah.
        setPendingWarning(result.warnings![0]);
        return;
      }
      toast.success('Barang masuk produk tersimpan.');
      setPendingWarning(null);
      form.reset(productStockInEmptyValues);
      // Produk yang dipilih TETAP kepilih (gak balik ke list kosong) — biar
      // gampang nambah batch lagi buat produk yang sama beruntun.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-batches', selected?.id] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  function onSubmit(values: ProductStockInValues) {
    stockInMutation.mutate(values);
  }

  function confirmOverride() {
    stockInMutation.mutate({ ...form.getValues(), confirmOverride: true });
  }

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pilih Produk</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemSearchPicker
              items={productsQuery.data ?? []}
              isLoading={productsQuery.isLoading}
              selectedId={selected?.id ?? null}
              onSelect={selectProduct}
              search={search}
              onSearchChange={setSearch}
              emptyLabel="Tidak ada produk."
              renderSubtitle={(p) =>
                p.stock > 0
                  ? `Stok: ${p.stock} • ${formatRupiah(p.sellPriceMin ?? 0)}${
                      p.sellPriceMax && p.sellPriceMax !== p.sellPriceMin
                        ? ` - ${formatRupiah(p.sellPriceMax)}`
                        : ''
                    }`
                  : 'Belum ada batch (stok 0)'
              }
            />
          </CardContent>
        </Card>

        <div className="grid gap-6">
          {!selected ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Pilih produk dulu di kiri buat input barang masuk.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{selected.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {batchesQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Memuat batch...</p>
                  ) : !batchesQuery.data || batchesQuery.data.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Belum ada batch aktif — produk ini belum punya stok/harga jual.
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
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
                      <FormField
                        control={form.control}
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
                          control={form.control}
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
                          control={form.control}
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
            </>
          )}
        </div>
      </div>

      <Dialog open={!!pendingWarning} onOpenChange={(open) => !open && setPendingWarning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Harga jual di bawah/pas modal</DialogTitle>
            <DialogDescription>
              Batch ini bakal disimpan dengan harga jual yang gak untung (atau pas-pasan
              modal). Cek lagi sebelum lanjut.
            </DialogDescription>
          </DialogHeader>
          {pendingWarning && (
            <div className="grid gap-1 rounded-md border p-3 text-sm">
              <SummaryRow label="Harga Modal" value={formatRupiah(pendingWarning.buyPrice)} />
              <SummaryRow label="Harga Jual" value={formatRupiah(pendingWarning.sellPrice)} />
              <SummaryRow
                label="Harga Efektif"
                value={formatRupiah(pendingWarning.effectivePrice)}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingWarning(null)}
              disabled={stockInMutation.isPending}
            >
              Batal
            </Button>
            <Button type="button" onClick={confirmOverride} disabled={stockInMutation.isPending}>
              {stockInMutation.isPending ? 'Menyimpan...' : 'Tetap Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ----------------------------------------------------------------------------
// Tab Sparepart — jauh lebih sederhana: cuma nambah qty + catat harga modal
// (item_costs, buat HPP di Laporan). Harga jual & stok yang KELIATAN di POS
// tetap kolom langsung di tabel spareparts (StockLockingService.lockAndAdd),
// gak ada konsep batch/harga-jual-per-batch kayak produk, jadi gak ada
// tabel batch atau dialog below-cost di sini (backend emang gak ngecek itu
// buat kind='sparepart').
// ----------------------------------------------------------------------------

const sparepartStockInSchema = z.object({
  qty: requiredNumberField('Qty wajib diisi'),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  note: z.string().optional(),
});
type SparepartStockInValues = z.infer<typeof sparepartStockInSchema>;

const sparepartStockInEmptyValues: SparepartStockInValues = { qty: '', buyPrice: '', note: '' };

function SparepartStockInTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Sparepart | null>(null);

  const sparepartsQuery = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });

  const form = useForm<SparepartStockInValues>({
    resolver: zodResolver(sparepartStockInSchema),
    defaultValues: sparepartStockInEmptyValues,
  });

  function selectSparepart(s: Sparepart) {
    setSelected(s);
    form.reset(sparepartStockInEmptyValues);
  }

  const stockInMutation = useMutation({
    mutationFn: (values: SparepartStockInValues) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'sparepart',
        refId: selected!.id,
        qty: Number(values.qty),
        buyPrice: Number(values.buyPrice),
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: () => {
      toast.success('Barang masuk sparepart tersimpan.');
      form.reset(sparepartStockInEmptyValues);
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  function onSubmit(values: SparepartStockInValues) {
    stockInMutation.mutate(values);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pilih Sparepart</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemSearchPicker
            items={sparepartsQuery.data ?? []}
            isLoading={sparepartsQuery.isLoading}
            selectedId={selected?.id ?? null}
            onSelect={selectSparepart}
            search={search}
            onSearchChange={setSearch}
            emptyLabel="Tidak ada sparepart."
            renderSubtitle={(s) => `Stok: ${s.stock} ${s.unit} • ${formatRupiah(s.sellPrice)}`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{selected ? selected.name : 'Barang Masuk'}</CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Pilih sparepart dulu di kiri buat input barang masuk.
            </p>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
                <FormField
                  control={form.control}
                  name="qty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Qty Masuk ({selected.unit})</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared: picker search+list, pola sama kayak ItemList/ItemRow di pos/page.tsx
// — dibikin generik di sini karena dipakai 2 tab (Produk & Sparepart) dengan
// bentuk data beda, tapi murni presentasional (gak nyimpen state form/query).
// ----------------------------------------------------------------------------

function ItemSearchPicker<T extends { id: string; name: string }>({
  items,
  isLoading,
  selectedId,
  onSelect,
  renderSubtitle,
  search,
  onSearchChange,
  emptyLabel,
}: {
  items: T[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (item: T) => void;
  renderSubtitle: (item: T) => string;
  search: string;
  onSearchChange: (value: string) => void;
  emptyLabel: string;
}) {
  const q = search.trim().toLowerCase();
  const filtered = items.filter((item) => item.name.toLowerCase().includes(q));

  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari nama..."
          className="pl-9"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="grid max-h-96 gap-1 overflow-y-auto">
          {filtered.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelect(item)}
              className={`rounded-md px-2 py-2 text-left transition-colors hover:bg-accent ${
                selectedId === item.id ? 'bg-accent' : ''
              }`}
            >
              <p className="text-sm font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">{renderSubtitle(item)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
