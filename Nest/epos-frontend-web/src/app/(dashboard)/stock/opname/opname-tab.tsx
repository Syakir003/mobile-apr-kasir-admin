'use client';

import * as React from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

// Opname (koreksi stok fisik) — beda perlakuan dari "Barang Masuk" karena
// produk sekarang punya banyak batch (item_costs), jadi koreksi opname
// produk WAJIB nunjuk satu batch spesifik (itemCostId), bukan produk secara
// umum. Sparepart tetap 1 baris stok langsung, jadi koreksinya simpel kayak
// dulu. Makanya 2 tab BENERAN terpisah (bukan 1 form + toggle kind), sama
// kayak pola ProductStockInTab/SparepartStockInTab di stock-client.tsx —
// ItemSearchPicker di bawah ini SALINAN lokal (bukan di-import dari file
// itu), soalnya stock-client.tsx bukan file yang publish komponen.
//
// Endpoint /stock/opname langsung commit begitu di-submit (gak ada alur
// confirm_required kayak /stock/in buat harga di bawah modal) — respons
// selalu array hasil koreksi, kita kirim 1 item per submit jadi tinggal
// ambil result[0].

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

interface Sparepart {
  id: string;
  name: string;
  unit: string;
  sellPrice: string;
  stock: string;
}

interface OpnameResult {
  refId: string;
  itemCostId: string | null;
  name: string;
  systemQty: number;
  physicalQty: number;
  delta: number;
}

// Toast hasil opname sama buat produk & sparepart — delta 0 itu tetap
// sukses (backend gak nyatet StockMovement apa-apa buat kasus ini, bukan
// error), jadi pesannya dibedain biar gak keliatan kayak gak ngapa-ngapain.
function toastOpnameResult(result: OpnameResult) {
  if (result.delta === 0) {
    toast.success('Stok sudah sesuai, gak ada perubahan.');
    return;
  }
  const sign = result.delta > 0 ? '+' : '';
  toast.success(
    `Stok dikoreksi: ${sign}${result.delta} (sistem ${result.systemQty} → fisik ${result.physicalQty}).`,
  );
}

export function OpnameTab() {
  return (
    <Tabs defaultValue="product">
      <TabsList className="grid w-full max-w-md grid-cols-2">
        <TabsTrigger value="product">Produk</TabsTrigger>
        <TabsTrigger value="sparepart">Sparepart</TabsTrigger>
      </TabsList>
      <TabsContent value="product" className="mt-4">
        <ProductOpnameTab />
      </TabsContent>
      <TabsContent value="sparepart" className="mt-4">
        <SparepartOpnameTab />
      </TabsContent>
    </Tabs>
  );
}

// ----------------------------------------------------------------------------
// Sub-tab Produk — pilih produk dulu, terus pilih SATU batch dari daftar
// batch aktifnya (produk bisa punya banyak batch harga sekaligus), baru
// bisa opname. Stok Sistem dihitung reaktif dari cache batchesQuery (bukan
// snapshot statis pas milih batch) biar abis submit sukses & query
// ke-invalidate, angkanya otomatis update kalau user mau opname lagi ke
// batch yang sama tanpa perlu pilih ulang.
// ----------------------------------------------------------------------------

const productOpnameSchema = z.object({
  physicalQty: requiredNumberField('Stok fisik wajib diisi').refine(
    (v) => Number.isInteger(Number(v)),
    'Stok fisik produk harus bilangan bulat',
  ),
  note: z.string().optional(),
});
type ProductOpnameValues = z.infer<typeof productOpnameSchema>;

const productOpnameEmptyValues: ProductOpnameValues = { physicalQty: '', note: '' };

function ProductOpnameTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Product | null>(null);
  const [selectedBatchId, setSelectedBatchId] = React.useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => apiClient.get<Product[]>('/products'),
  });

  const batchesQuery = useQuery({
    queryKey: ['product-batches', selected?.id],
    queryFn: () => apiClient.get<ProductBatch[]>(`/products/${selected!.id}/batches`),
    enabled: !!selected,
  });

  const form = useForm<ProductOpnameValues>({
    resolver: zodResolver(productOpnameSchema),
    defaultValues: productOpnameEmptyValues,
  });

  function selectProduct(p: Product) {
    setSelected(p);
    setSelectedBatchId(null);
    form.reset(productOpnameEmptyValues);
  }

  function selectBatch(b: ProductBatch) {
    setSelectedBatchId(b.id);
    form.reset(productOpnameEmptyValues);
  }

  // Reaktif dari cache batchesQuery, bukan disimpen pas selectBatch — lihat
  // catatan di header blok ini.
  const selectedBatch = batchesQuery.data?.find((b) => b.id === selectedBatchId) ?? null;

  const opnameMutation = useMutation({
    mutationFn: (values: ProductOpnameValues) =>
      apiClient.post<OpnameResult[]>('/stock/opname', {
        items: [
          {
            kind: 'product',
            refId: selected!.id,
            itemCostId: selectedBatchId!,
            physicalQty: Number(values.physicalQty),
          },
        ],
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: (result) => {
      toastOpnameResult(result[0]);
      form.reset(productOpnameEmptyValues);
      // Produk & batch yang dipilih TETAP kepilih, cuma field physicalQty +
      // note yang direset — biar gampang cross-check angka sistem yang baru
      // ke-update kalau mau opname ulang.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-batches', selected?.id] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan opname.');
    },
  });

  function onSubmit(values: ProductOpnameValues) {
    opnameMutation.mutate(values);
  }

  return (
    // Picker cuma daftar nama+subtitle pendek, jadi dikasih kolom sempit
    // (360px) — sisa lebar (1fr) buat tabel batch (5 kolom, ada harga
    // rupiah) & form koreksi, biar gak kepotong kayak sebelumnya
    // (grid-cols dulu kebalik: picker 1fr/lebar, tabel batch malah kepepet
    // di kolom 420px).
    <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
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
              Pilih produk dulu di kiri buat opname.
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
                    Belum ada batch aktif — gak ada yang bisa dikoreksi.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
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
                          <TableRow
                            key={b.id}
                            onClick={() => selectBatch(b)}
                            className={`cursor-pointer ${
                              selectedBatchId === b.id ? 'bg-accent' : ''
                            }`}
                          >
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
                <CardTitle className="text-base">Koreksi Stok Batch</CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedBatch ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Pilih batch di tabel atas dulu.
                  </p>
                ) : (
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
                      <div className="flex items-center justify-between rounded-md border p-3 text-sm">
                        <span className="text-muted-foreground">Stok Sistem</span>
                        <span className="font-medium">{selectedBatch.stock}</span>
                      </div>
                      <FormField
                        control={form.control}
                        name="physicalQty"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Stok Fisik</FormLabel>
                            <FormControl>
                              <Input inputMode="numeric" placeholder="0" {...field} />
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
                      <Button type="submit" disabled={opnameMutation.isPending}>
                        {opnameMutation.isPending ? 'Menyimpan...' : 'Simpan Koreksi'}
                      </Button>
                    </form>
                  </Form>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-tab Sparepart — gak ada konsep batch, jadi langsung 1 form begitu
// sparepart kepilih.
// ----------------------------------------------------------------------------

const sparepartOpnameSchema = z.object({
  physicalQty: requiredNumberField('Stok fisik wajib diisi'),
  note: z.string().optional(),
});
type SparepartOpnameValues = z.infer<typeof sparepartOpnameSchema>;

const sparepartOpnameEmptyValues: SparepartOpnameValues = { physicalQty: '', note: '' };

function SparepartOpnameTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Sparepart | null>(null);

  const sparepartsQuery = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });

  const form = useForm<SparepartOpnameValues>({
    resolver: zodResolver(sparepartOpnameSchema),
    defaultValues: sparepartOpnameEmptyValues,
  });

  function selectSparepart(s: Sparepart) {
    setSelected(s);
    form.reset(sparepartOpnameEmptyValues);
  }

  // Reaktif dari cache sparepartsQuery (sama alasannya kayak batch produk di
  // atas) — stock di Sparepart string (Decimal Postgres di-JSON-kan), parse
  // dulu.
  const systemQty = Number(
    sparepartsQuery.data?.find((s) => s.id === selected?.id)?.stock ?? 0,
  );

  const opnameMutation = useMutation({
    mutationFn: (values: SparepartOpnameValues) =>
      apiClient.post<OpnameResult[]>('/stock/opname', {
        items: [
          {
            kind: 'sparepart',
            refId: selected!.id,
            physicalQty: Number(values.physicalQty),
          },
        ],
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: (result) => {
      toastOpnameResult(result[0]);
      form.reset(sparepartOpnameEmptyValues);
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan opname.');
    },
  });

  function onSubmit(values: SparepartOpnameValues) {
    opnameMutation.mutate(values);
  }

  return (
    // Konsisten sama tab Produk di atas — picker sempit (360px), sisanya
    // buat kartu form.
    <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
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
          <CardTitle className="text-base">{selected ? selected.name : 'Opname Sparepart'}</CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Pilih sparepart dulu di kiri buat opname.
            </p>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
                <div className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <span className="text-muted-foreground">Stok Sistem</span>
                  <span className="font-medium">
                    {systemQty} {selected.unit}
                  </span>
                </div>
                <FormField
                  control={form.control}
                  name="physicalQty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stok Fisik ({selected.unit})</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="0" {...field} />
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
                <Button type="submit" disabled={opnameMutation.isPending}>
                  {opnameMutation.isPending ? 'Menyimpan...' : 'Simpan Koreksi'}
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
// Salinan lokal ItemSearchPicker dari stock-client.tsx (file itu gak publish
// komponen buat di-import file lain) — persis sama, murni presentasional.
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
