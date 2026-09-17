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
import { requiredNumberField, optionalNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
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

// Padanan model Sparepart Prisma. `sellPrice`, `stock`, `minStock` semuanya
// DECIMAL di Postgres -> Prisma Decimal -> string lewat JSON.
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

const sparepartSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  sku: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().min(1, 'Wajib diisi (mis. pcs, kg, meter)'),
  sellPrice: requiredNumberField('Harga jual wajib diisi'),
  stock: requiredNumberField('Stok wajib diisi'),
  minStock: optionalNumberField,
  active: z.boolean(),
});
type SparepartFormValues = z.infer<typeof sparepartSchema>;

const emptyValues: SparepartFormValues = {
  name: '',
  sku: '',
  category: '',
  unit: '',
  sellPrice: '',
  stock: '',
  minStock: '',
  active: true,
};

function toFormValues(s: Sparepart): SparepartFormValues {
  return {
    name: s.name,
    sku: s.sku ?? '',
    category: s.category ?? '',
    unit: s.unit,
    sellPrice: s.sellPrice,
    stock: s.stock,
    minStock: s.minStock,
    active: s.active,
  };
}

export default function SparepartPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Sparepart | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });

  const form = useForm<SparepartFormValues>({
    resolver: zodResolver(sparepartSchema),
    defaultValues: emptyValues,
  });

  function openCreate() {
    setEditing(null);
    form.reset(emptyValues);
    setDialogOpen(true);
  }

  function openEdit(s: Sparepart) {
    setEditing(s);
    form.reset(toFormValues(s));
    setDialogOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: SparepartFormValues) => {
      const base = {
        name: values.name.trim(),
        sku: trimmedOrUndefined(values.sku),
        category: trimmedOrUndefined(values.category),
        unit: values.unit.trim(),
        sellPrice: Number(values.sellPrice),
        minStock: values.minStock?.trim() ? Number(values.minStock) : undefined,
      };
      if (editing) {
        // Stok gak dikirim di update — cuma lewat halaman detail (klik baris
        // di tabel) biar StockMovement-nya konsisten.
        return apiClient.patch<Sparepart>(`/spareparts/${editing.id}`, {
          ...base,
          active: values.active,
        });
      }
      return apiClient.post<Sparepart>('/spareparts', {
        ...base,
        stock: Number(values.stock),
      });
    },
    onSuccess: () => {
      toast.success(editing ? 'Sparepart diperbarui.' : 'Sparepart ditambahkan.');
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
      setDialogOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan sparepart.');
    },
  });

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sparepart</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bahan & komponen servis — freon, pipa, bracket, dsb. Klik baris buat lihat & tambah
            stok.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Tambah Sparepart
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Memuat sparepart...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat data sparepart.</p>}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <p className="text-sm text-muted-foreground">
          Belum ada sparepart. Klik &ldquo;Tambah Sparepart&rdquo; untuk mulai.
        </p>
      )}
      {!isLoading && !isError && data && data.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>SKU / Kategori</TableHead>
                <TableHead>Harga Jual</TableHead>
                <TableHead>Stok</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/master/sparepart/${s.id}`)}
                >
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {[s.sku, s.category].filter(Boolean).join(' • ') || '-'}
                  </TableCell>
                  <TableCell>{formatRupiah(s.sellPrice)}</TableCell>
                  <TableCell>
                    {s.stock} {s.unit}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.active ? 'success' : 'secondary'}>
                      {s.active ? 'Aktif' : 'Nonaktif'}
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
                          openEdit(s);
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
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Sparepart' : 'Tambah Sparepart'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Ubah data sparepart. Stok tidak diubah dari sini — klik baris di tabel buat tambah stok.'
                : 'Isi data sparepart baru.'}
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
                      <Input placeholder="Contoh: Pipa AC 1/4 inch" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SKU</FormLabel>
                      <FormControl>
                        <Input placeholder="Opsional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
              </div>
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Satuan</FormLabel>
                    <FormControl>
                      <Input placeholder="pcs, kg, meter, set" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
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
                <FormField
                  control={form.control}
                  name="minStock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stok Minimum</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {!editing && (
                <FormField
                  control={form.control}
                  name="stock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stok Awal</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
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
                        Sparepart aktif (tampil di POS/servis)
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
