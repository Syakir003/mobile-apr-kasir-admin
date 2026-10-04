'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ChevronRight, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { requiredNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusFilterSelect, type MasterDataStatus } from '@/components/master-data/status-filter-select';
import { PaginationFooter, SearchBox, useListView } from '@/components/master-data/list-controls';
import { DeactivateDialog } from '@/components/master-data/deactivate-dialog';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MODE_OPTIONS,
  SPAREPART_TEMPLATE_GROUPS,
  formatStock,
  hasPackSale,
  type SparepartMode,
} from '@/lib/sparepart-mode';
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
  // Siklus sparepart-per-gulungan (2026-09-23).
  batchTracked: boolean;
  // Mode utuh/eceran (2026-09-30). `unit` = satuan kecil.
  trackingMode: SparepartMode;
  packUnit: string | null;
  packSize: string | null;
  sellPricePack: string | null;
}

const sparepartSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  sku: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().min(1, 'Wajib diisi (mis. pcs, kg, meter)'),
  sellPrice: requiredNumberField('Harga jual wajib diisi'),
  stock: requiredNumberField('Stok wajib diisi'),
  active: z.boolean(),
  trackingMode: z.enum(['biasa', 'gulungan', 'konversi', 'gabungan']),
  packUnit: z.string().optional(),
  packSize: z.string().optional(),
  sellPricePack: z.string().optional(),
  // Stok awal mode kemasan: satuan input ('pack' = satuan besar) + modal.
  stockIn: z.enum(['pack', 'unit']),
  initialBuyPrice: z.string().optional(),
}).superRefine((v, ctx) => {
  if (!hasPackSale(v.trackingMode)) return;
  if (Number(v.stock) > 0 && !(Number(v.initialBuyPrice) > 0)) {
    ctx.addIssue({
      code: 'custom',
      path: ['initialBuyPrice'],
      message: 'Harga modal wajib diisi kalau ada stok awal',
    });
  }
  if (!v.packUnit?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['packUnit'], message: 'Wajib diisi (mis. roll, tabung, dus)' });
  }
  const size = Number(v.packSize);
  if (!v.packSize?.trim() || Number.isNaN(size) || size <= 0) {
    ctx.addIssue({ code: 'custom', path: ['packSize'], message: 'Isi harus lebih dari 0' });
  }
  const pack = Number(v.sellPricePack);
  if (!v.sellPricePack?.trim() || Number.isNaN(pack) || pack <= 0) {
    ctx.addIssue({ code: 'custom', path: ['sellPricePack'], message: 'Harga utuh wajib diisi' });
  }
});
type SparepartFormValues = z.infer<typeof sparepartSchema>;

const emptyValues: SparepartFormValues = {
  name: '',
  sku: '',
  category: '',
  unit: '',
  sellPrice: '',
  stock: '0',
  active: true,
  trackingMode: 'biasa',
  packUnit: '',
  packSize: '',
  sellPricePack: '',
  stockIn: 'pack',
  initialBuyPrice: '',
};

function toFormValues(s: Sparepart): SparepartFormValues {
  return {
    name: s.name,
    sku: s.sku ?? '',
    category: s.category ?? '',
    unit: s.unit,
    sellPrice: s.sellPrice,
    stock: s.stock,
    active: s.active,
    trackingMode: s.trackingMode ?? (s.batchTracked ? 'gulungan' : 'biasa'),
    packUnit: s.packUnit ?? '',
    packSize: s.packSize ?? '',
    sellPricePack: s.sellPricePack ?? '',
    stockIn: 'pack',
    initialBuyPrice: '',
  };
}

export default function SparepartPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Sparepart | null>(null);
  const [status, setStatus] = React.useState<MasterDataStatus>('active');
  const [deactivating, setDeactivating] = React.useState<Sparepart | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['spareparts', status],
    queryFn: () => apiClient.get<Sparepart[]>(`/spareparts?status=${status}`),
  });
  const view = useListView(data, (s) => [s.name, s.sku, s.category, s.unit].join(' '));

  const form = useForm<SparepartFormValues>({
    resolver: zodResolver(sparepartSchema),
    defaultValues: emptyValues,
  });
  const mode = form.watch('trackingMode');
  const packMode = hasPackSale(mode);

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

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const saveMutation = useMutation({
    mutationFn: async (values: SparepartFormValues) => {
      const pack = hasPackSale(values.trackingMode);
      const base = {
        name: values.name.trim(),
        sku: trimmedOrUndefined(values.sku),
        category: trimmedOrUndefined(values.category),
        unit: values.unit.trim(),
        sellPrice: Number(values.sellPrice),
        trackingMode: values.trackingMode,
        ...(pack
          ? {
              packUnit: values.packUnit!.trim(),
              packSize: Number(values.packSize),
              sellPricePack: Number(values.sellPricePack),
            }
          : {}),
      };
      if (editing) {
        // Stok gak dikirim di update — cuma lewat halaman detail (klik baris
        // di tabel) biar StockMovement-nya konsisten.
        const updated = await apiClient.patch<Sparepart>(`/spareparts/${editing.id}`, {
          ...base,
          active: values.active,
        });
        return { sparepart: updated, stockInError: null as string | null };
      }

      // Mode kemasan (konversi/gabungan): stok awal bisa diinput dalam satuan
      // besar ATAU kecil. Sparepart dibuat dengan stok 0, lalu stok awal masuk
      // lewat alur Barang Masuk (biar ada modal + riwayat mutasi; mode
      // gabungan juga butuh baris roll).
      const enteredQty = Number(values.stock);
      if (!pack) {
        const created = await apiClient.post<Sparepart>('/spareparts', { ...base, stock: enteredQty });
        return { sparepart: created, stockInError: null as string | null };
      }
      const created = await apiClient.post<Sparepart>('/spareparts', { ...base, stock: 0 });
      const packSize = Number(values.packSize);
      const inPack = values.stockIn === 'pack';
      const baseQty = round2(inPack ? enteredQty * packSize : enteredQty);
      if (!(baseQty > 0)) return { sparepart: created, stockInError: null as string | null };
      const buyPricePerBase = round2(Number(values.initialBuyPrice) / (inPack ? packSize : 1));
      try {
        if (values.trackingMode === 'gabungan') {
          const full = Math.floor(baseQty / packSize + 1e-9);
          const rest = round2(baseQty - full * packSize);
          const rolls = Array.from({ length: full }, () => ({ length: packSize }));
          if (rest > 0) rolls.push({ length: rest });
          await apiClient.post('/stock/in', {
            kind: 'sparepart',
            refId: created.id,
            rolls,
            buyPrice: buyPricePerBase,
            note: 'Stok awal',
          });
        } else {
          await apiClient.post('/stock/in', {
            kind: 'sparepart',
            refId: created.id,
            qty: baseQty,
            buyPrice: buyPricePerBase,
            note: 'Stok awal',
          });
        }
        return { sparepart: created, stockInError: null as string | null };
      } catch (err) {
        return {
          sparepart: created,
          stockInError: err instanceof ApiError ? err.message : 'Gagal menyimpan stok awal.',
        };
      }
    },
    onSuccess: (result) => {
      if (result.stockInError) {
        toast.warning(
          `Sparepart ditambahkan, tapi stok awal gagal disimpan: ${result.stockInError} Tambahkan stoknya lewat halaman detail (Barang Masuk).`,
        );
      } else {
        toast.success(editing ? 'Sparepart diperbarui.' : 'Sparepart ditambahkan.');
      }
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
      setDialogOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan sparepart.');
    },
  });

  function applyTemplate(key: string) {
    const t = SPAREPART_TEMPLATE_GROUPS.flatMap((g) => g.items).find((i) => i.key === key);
    if (!t) return;
    form.setValue('trackingMode', t.mode);
    form.setValue('unit', t.unit);
    form.setValue('packUnit', t.packUnit ?? '');
    form.setValue('packSize', t.packSize ?? '');
    if (!form.getValues('name').trim()) form.setValue('name', t.name);
    if (!form.getValues('category')?.trim()) form.setValue('category', t.category);
  }

  const toggleActiveMutation = useMutation({
    mutationFn: (s: Sparepart) =>
      apiClient.patch<Sparepart>(`/spareparts/${s.id}`, { active: !s.active }),
    onSuccess: (_data, s) => {
      toast.success(s.active ? 'Sparepart dinonaktifkan.' : 'Sparepart diaktifkan kembali.');
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
      setDeactivating(null);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengubah status sparepart.');
    },
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sparepart</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bahan & komponen servis — freon, pipa, bracket, dsb. Klik baris buat lihat & tambah
            stok.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusFilterSelect value={status} onChange={setStatus} />
          <Button onClick={openCreate}>
            <Plus />
            Tambah Sparepart
          </Button>
        </div>
      </div>

      <SearchBox value={view.search} onChange={view.setSearch} placeholder="Cari nama, SKU, kategori, atau satuan..." />

      {isLoading && <p className="text-sm text-muted-foreground">Memuat sparepart...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat data sparepart.</p>}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <p className="text-sm text-muted-foreground">
          Belum ada sparepart. Klik &ldquo;Tambah Sparepart&rdquo; untuk mulai.
        </p>
      )}
      {!isLoading && !isError && data && data.length > 0 && view.total === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada sparepart yang cocok dengan pencarian.</p>
      )}
      {!isLoading && !isError && data && data.length > 0 && view.total > 0 && (
        <>
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
              {view.pageItems.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/master/sparepart/${s.id}`)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {s.name}
                      {s.trackingMode !== 'biasa' && (
                        <Badge variant="secondary" className="text-xs font-normal">
                          {s.trackingMode === 'gulungan'
                            ? 'Per Gulungan'
                            : s.trackingMode === 'konversi'
                              ? 'Utuh + Eceran'
                              : 'Gabungan'}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[s.sku, s.category].filter(Boolean).join(' • ') || '-'}
                  </TableCell>
                  <TableCell>
                    {hasPackSale(s.trackingMode) && s.sellPricePack ? (
                      <div className="leading-tight">
                        <div>
                          {formatRupiah(s.sellPricePack)}
                          <span className="text-xs text-muted-foreground"> / {s.packUnit}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatRupiah(s.sellPrice)} / {s.unit}
                        </div>
                      </div>
                    ) : (
                      formatRupiah(s.sellPrice)
                    )}
                  </TableCell>
                  <TableCell>{formatStock(s)}</TableCell>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        title={s.active ? 'Nonaktifkan' : 'Aktifkan kembali'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeactivating(s);
                        }}
                      >
                        {s.active ? (
                          <Trash2 className="size-4 text-destructive" />
                        ) : (
                          <RotateCcw className="size-4" />
                        )}
                      </Button>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PaginationFooter page={view.page} totalPages={view.totalPages} total={view.total} noun="sparepart" onPage={view.setPage} />
        </>
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
              {!editing && (
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Template cepat</span>
                  <Select value="" onValueChange={applyTemplate}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih jenis sparepart AC (isi otomatis mode & satuan)" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {SPAREPART_TEMPLATE_GROUPS.map((g) => (
                        <SelectGroup key={g.label}>
                          <SelectLabel>{g.label}</SelectLabel>
                          {g.items.map((t) => (
                            <SelectItem key={t.key} value={t.key}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Isi kemasan cuma contoh umum — sesuaikan dengan barang yang kamu beli.
                  </p>
                </div>
              )}
              <FormField
                control={form.control}
                name="trackingMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipe / mode sparepart</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        // Mode per-gulungan wajib mulai dari stok 0 (lihat
                        // SparepartsService.create) — paksa biar gak nyangkut.
                        if (v === 'gulungan') form.setValue('stock', '0');
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MODE_OPTIONS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {MODE_OPTIONS.find((m) => m.value === field.value)?.hint} Bisa diubah lagi
                      nanti.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{packMode ? 'Satuan kecil (eceran)' : 'Satuan'}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={packMode ? 'm, kg, liter, pcs' : 'pcs, kg, meter, set'}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {packMode && (
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="packUnit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Satuan besar (utuh)</FormLabel>
                        <FormControl>
                          <Input placeholder="roll, tabung, dus" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="packSize"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Isi per {form.watch('packUnit')?.trim() || 'satuan besar'} (
                          {form.watch('unit')?.trim() || 'satuan kecil'})
                        </FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="15" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
              <div className={packMode ? 'grid grid-cols-2 gap-4' : 'grid gap-4'}>
                <FormField
                  control={form.control}
                  name="sellPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {packMode
                          ? `Harga jual eceran / ${form.watch('unit')?.trim() || 'satuan kecil'}`
                          : 'Harga Jual'}
                      </FormLabel>
                      <FormControl>
                        <CurrencyInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {packMode && (
                  <FormField
                    control={form.control}
                    name="sellPricePack"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Harga jual utuh / {form.watch('packUnit')?.trim() || 'satuan besar'}
                        </FormLabel>
                        <FormControl>
                          <CurrencyInput {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
              {!editing &&
                (mode === 'gulungan' ? (
                  <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    Sparepart per-gulungan gak bisa diisi stok awal di sini — tambahkan gulungan
                    pertama lewat menu Barang Masuk setelah sparepart ini dibuat.
                  </p>
                ) : packMode ? (
                  <InitialStockPack form={form} />
                ) : (
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
                ))}
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

      {deactivating && (
        <DeactivateDialog
          open={!!deactivating}
          onOpenChange={(open) => !open && setDeactivating(null)}
          itemName={deactivating.name}
          willActivate={!deactivating.active}
          stockWarning={
            Number(deactivating.stock) > 0
              ? `Sparepart ini masih punya stok ${deactivating.stock} ${deactivating.unit}.`
              : undefined
          }
          onConfirm={() => toggleActiveMutation.mutate(deactivating)}
          isPending={toggleActiveMutation.isPending}
        />
      )}
    </div>
  );
}

// Stok awal mode kemasan (konversi/gabungan): pilih input dalam satuan besar
// atau kecil, langsung tampil padanannya (mis. 50 m = 3 roll + 5 m). Modal
// wajib kalau ada stok awal; dicatat lewat alur Barang Masuk.
function InitialStockPack({ form }: { form: UseFormReturn<SparepartFormValues> }) {
  const unit = form.watch('unit')?.trim() || 'satuan kecil';
  const packUnit = form.watch('packUnit')?.trim() || 'satuan besar';
  const size = Number(form.watch('packSize') || 0);
  const inPack = form.watch('stockIn') === 'pack';
  const qty = Number(form.watch('stock') || 0);
  const price = Number(form.watch('initialBuyPrice') || 0);
  const mode = form.watch('trackingMode');
  const baseQty = Math.round((inPack ? qty * size : qty) * 100) / 100;
  const ready = qty > 0 && size > 0;
  const equivalent = ready
    ? formatStock({ stock: baseQty, unit, trackingMode: 'konversi', packUnit, packSize: size })
    : '';
  const full = ready ? Math.floor(baseQty / size + 1e-9) : 0;
  const rest = ready ? Math.round((baseQty - full * size) * 100) / 100 : 0;

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <FormField
        control={form.control}
        name="stockIn"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Stok awal — input dalam satuan</FormLabel>
            <div className="flex gap-2">
              {(['pack', 'unit'] as const).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={field.value === k ? 'default' : 'outline'}
                  onClick={() => field.onChange(k)}
                >
                  {k === 'pack' ? packUnit : unit}
                </Button>
              ))}
            </div>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="stock"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Stok Awal ({inPack ? packUnit : unit})</FormLabel>
            <FormControl>
              <Input inputMode="decimal" placeholder="0" {...field} />
            </FormControl>
            {ready && (
              <p className="text-xs font-medium text-primary">
                {inPack ? `${qty} ${packUnit} = ${baseQty} ${unit}` : `${baseQty} ${unit} ≈ ${equivalent}`}
                {mode === 'gabungan' && rest > 0 && full >= 0
                  ? ` (dicatat ${full > 0 ? `${full} ${packUnit} penuh + ` : ''}1 ${packUnit} terbuka ${rest} ${unit})`
                  : ''}
              </p>
            )}
            <FormMessage />
          </FormItem>
        )}
      />
      {qty > 0 && (
        <FormField
          control={form.control}
          name="initialBuyPrice"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Harga modal (per {inPack ? packUnit : unit})</FormLabel>
              <FormControl>
                <CurrencyInput {...field} />
              </FormControl>
              {price > 0 && size > 0 && inPack && (
                <p className="text-xs text-muted-foreground">
                  = {formatRupiah(Math.round((price / size) * 100) / 100)} per {unit}
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
