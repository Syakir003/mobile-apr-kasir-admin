'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ChevronRight, Pencil, Plus } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import {
  requiredNumberField,
  optionalIntField,
  trimmedOrUndefined,
  numberOrUndefined,
} from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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

// Padanan model Product Prisma (products.controller.ts / schema.prisma).
// `pk` DECIMAL -> Prisma Decimal -> string lewat JSON. `sellPrice`/`stock`
// yang DULU kolom langsung di sini SEKARANG DIHAPUS dari tabel `products`
// (Siklus batch-cost 2026-09) — harga & stok agregat dari batch (item_costs)
// via ProductsService.priceAggFor, dikirim backend sebagai field tambahan
// `stock`/`sellPriceMin`/`sellPriceMax` di respons GET (bukan kolom asli).
interface Product {
  id: string;
  sku: string | null;
  name: string;
  brand: string | null;
  type: string | null;
  pk: string | null;
  inverter: boolean;
  btu: number | null;
  watt: number | null;
  warranty: string | null;
  stock: number;
  sellPriceMin: number | null;
  sellPriceMax: number | null;
  description: string | null;
  category: string | null;
  active: boolean;
}

const productSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  brand: z.string().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  pk: requiredNumberField('PK wajib diisi'),
  inverter: z.boolean(),
  btu: optionalIntField,
  watt: optionalIntField,
  warranty: z.string().optional(),
  description: z.string().optional(),
  active: z.boolean(),
});
type ProductFormValues = z.infer<typeof productSchema>;

const emptyValues: ProductFormValues = {
  name: '',
  brand: '',
  type: '',
  category: '',
  pk: '',
  inverter: false,
  btu: '',
  watt: '',
  warranty: '',
  description: '',
  active: true,
};

function toFormValues(p: Product): ProductFormValues {
  return {
    name: p.name,
    brand: p.brand ?? '',
    type: p.type ?? '',
    category: p.category ?? '',
    pk: p.pk ?? '',
    inverter: p.inverter,
    btu: p.btu?.toString() ?? '',
    watt: p.watt?.toString() ?? '',
    warranty: p.warranty ?? '',
    description: p.description ?? '',
    active: p.active,
  };
}

export default function ProdukPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['products'],
    queryFn: () => apiClient.get<Product[]>('/products'),
  });

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: emptyValues,
  });

  function openCreate() {
    setEditing(null);
    form.reset(emptyValues);
    setDialogOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    form.reset(toFormValues(p));
    setDialogOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const base = {
        name: values.name.trim(),
        brand: trimmedOrUndefined(values.brand),
        type: trimmedOrUndefined(values.type),
        category: trimmedOrUndefined(values.category),
        pk: Number(values.pk),
        inverter: values.inverter,
        btu: numberOrUndefined(values.btu),
        watt: numberOrUndefined(values.watt),
        warranty: trimmedOrUndefined(values.warranty),
        description: trimmedOrUndefined(values.description),
      };
      if (editing) {
        // Stok & harga jual SENGAJA tidak dikirim di update — satu-satunya
        // jalur ubah itu sekarang StockService.stockIn() (halaman detail
        // produk, klik baris tabel), lihat komentar di UpdateProductDto
        // backend.
        return apiClient.patch<Product>(`/products/${editing.id}`, {
          ...base,
          active: values.active,
        });
      }
      // Produk baru mulai dengan 0 batch/0 stok — gak ada lagi field
      // sellPrice/stock di CreateProductDto (Siklus batch-cost 2026-09).
      // Admin WAJIB lanjut klik baris produk ini abis ini biar punya harga
      // jual & stok, baru bisa muncul di POS.
      return apiClient.post<Product>('/products', base);
    },
    onSuccess: (product, values) => {
      toast.success(editing ? 'Produk diperbarui.' : 'Produk ditambahkan.');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setDialogOpen(false);
      if (!editing) {
        // Ngingetin eksplisit — produk baru INVISIBLE di POS sampai
        // di-stock-in, gampang kelewat kalau cuma toast biasa.
        toast.info(`Klik baris "${values.name}" di tabel buat isi stok & harga jual pertamanya.`);
      }
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan produk.');
    },
  });

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produk AC</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Katalog unit AC yang dijual di POS. Klik baris buat lihat batch & tambah stok.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Tambah Produk
        </Button>
      </div>

      <ProductTable
        products={data}
        isLoading={isLoading}
        isError={isError}
        onEdit={openEdit}
        onRowClick={(p) => router.push(`/master/produk/${p.id}`)}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Produk' : 'Tambah Produk'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Ubah identitas & spesifikasi produk. Harga jual & stok diatur lewat halaman detail (klik baris di tabel).'
                : 'Isi identitas & spesifikasi produk baru. Harga jual & stok baru bisa diisi setelah produk ini disimpan, lewat halaman detail (klik baris di tabel).'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              className="grid gap-4"
              onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama</FormLabel>
                    <FormControl>
                      <Input placeholder="Contoh: AC Split 1 PK Inverter" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="brand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Merek</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipe</FormLabel>
                      <FormControl>
                        <Input placeholder="split, dll" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kategori</FormLabel>
                    <FormControl>
                      <Input placeholder="Opsional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="pk"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PK</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="btu"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>BTU</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="9000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="watt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Watt</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="660" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="warranty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Garansi</FormLabel>
                    <FormControl>
                      <Input placeholder="Mis. 1 tahun unit, 5 tahun kompresor" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deskripsi</FormLabel>
                    <FormControl>
                      <Textarea rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="inverter"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="font-normal">Inverter</FormLabel>
                  </FormItem>
                )}
              />
              {editing && (
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="font-normal">
                        Produk aktif (tampil di POS)
                      </FormLabel>
                    </FormItem>
                  )}
                />
              )}
              <DialogFooter>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductTable({
  products,
  isLoading,
  isError,
  onEdit,
  onRowClick,
}: {
  products: Product[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onEdit: (p: Product) => void;
  onRowClick: (p: Product) => void;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat produk...</p>;
  }
  if (isError) {
    return <p className="text-sm text-destructive">Gagal memuat data produk.</p>;
  }
  if (!products || products.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Belum ada produk. Klik &ldquo;Tambah Produk&rdquo; untuk mulai isi katalog.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Merek / Tipe</TableHead>
            <TableHead>Stok & Harga Jual</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => (
            <TableRow key={p.id} className="cursor-pointer" onClick={() => onRowClick(p)}>
              <TableCell className="text-muted-foreground">{p.sku || '-'}</TableCell>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {[p.brand, p.type].filter(Boolean).join(' • ') || '-'}
              </TableCell>
              <TableCell>
                {p.stock > 0 ? (
                  <div>
                    <p>{p.stock} unit</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRupiah(p.sellPriceMin ?? 0)}
                      {p.sellPriceMax && p.sellPriceMax !== p.sellPriceMin
                        ? ` - ${formatRupiah(p.sellPriceMax)}`
                        : ''}
                    </p>
                  </div>
                ) : (
                  <Badge variant="warning">Belum ada stok</Badge>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={p.active ? 'success' : 'secondary'}>
                  {p.active ? 'Aktif' : 'Nonaktif'}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(p);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
