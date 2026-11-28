'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ClipboardCheck, ChevronRight, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { FixPendingDialog } from '@/components/fix-pending-dialog';
import { formatRupiah } from '@/lib/format';
import {
  numberOrNull,
  optionalNumberField,
  requiredNumberField,
  trimmedOrUndefined,
} from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusFilterSelect, type MasterDataStatus } from '@/components/master-data/status-filter-select';
import { PaginationFooter, SearchBox, useListView } from '@/components/master-data/list-controls';
import { DeactivateDialog } from '@/components/master-data/deactivate-dialog';
import { useRole } from '@/lib/use-is-admin';
import { isPendingPrice, listWithPending } from '@/lib/pending-price';
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
import { PanelTitle, panelClass } from '@/components/ui/panel';
import Link from 'next/link';
import { ErrorBlock, LoadingBlock } from '@/components/query-state';

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
  // Qty yang sudah disetujui admin buat teknisi tapi belum dipakai.
  reserved?: number;
  minStock: string;
  active: boolean;
  // Siklus sparepart-per-gulungan (2026-09-23).
  batchTracked: boolean;
  // Mode utuh/eceran (2026-09-30). `unit` = satuan kecil.
  trackingMode: SparepartMode;
  packUnit: string | null;
  packSize: string | null;
  sellPricePack: string | null;
  // Harga per tipe pembeli (2026-10-13) — sellPrice/sellPricePack = Ritel.
  priceInstaller: number | null;
  priceReseller: number | null;
  pricePackInstaller: number | null;
  pricePackReseller: number | null;
}

const sparepartSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  sku: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().min(1, 'Wajib diisi (mis. pcs, kg, meter)'),
  // Wajib untuk admin (dicek di superRefine); gudang boleh mengosongkan.
  sellPrice: z.string().refine((v) => v.trim() === '' || !Number.isNaN(Number(v)), 'Harus berupa angka'),
  stock: requiredNumberField('Stok wajib diisi'),
  active: z.boolean(),
  trackingMode: z.enum(['biasa', 'gulungan', 'konversi', 'gabungan']),
  packUnit: z.string().optional(),
  packSize: z.string().optional(),
  sellPricePack: z.string().optional(),
  priceInstaller: optionalNumberField,
  priceReseller: optionalNumberField,
  pricePackInstaller: optionalNumberField,
  pricePackReseller: optionalNumberField,
  // Stok awal mode kemasan: satuan input ('pack' = satuan besar) + modal.
  stockIn: z.enum(['pack', 'unit']),
  initialBuyPrice: z.string().optional(),
  // true = gudang: tanpa harga modal.
  hidePrice: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (!v.hidePrice && !v.sellPrice.trim()) {
    ctx.addIssue({ code: 'custom', path: ['sellPrice'], message: 'Harga jual wajib diisi' });
  }
  if (!hasPackSale(v.trackingMode)) return;
  // Harga utuh per tipe butuh harga eceran tipe itu (aturan yang sama di server).
  for (const tier of ['Installer', 'Reseller'] as const) {
    if (v[`pricePack${tier}`]?.trim() && !v[`price${tier}`]?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: [`price${tier}`],
        message: `Isi dulu harga eceran ${tier}`,
      });
    }
  }
  if (!v.hidePrice && Number(v.stock) > 0 && !(Number(v.initialBuyPrice) > 0)) {
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
  if (!v.hidePrice && (!v.sellPricePack?.trim() || Number.isNaN(pack) || pack <= 0)) {
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
  priceInstaller: '',
  priceReseller: '',
  pricePackInstaller: '',
  pricePackReseller: '',
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
    // Stok tidak diubah lewat edit (tidak ikut dikirim). Diisi '0' supaya aturan
    // "stok awal wajib harga modal" tidak menahan Simpan: isiannya tidak tampil di sini.
    stock: '0',
    // Menunggu harga: begitu admin mengisi harga lalu simpan, langsung aktif.
    active: s.active || !(Number(s.sellPrice) > 0),
    trackingMode: s.trackingMode ?? (s.batchTracked ? 'gulungan' : 'biasa'),
    packUnit: s.packUnit ?? '',
    packSize: s.packSize ?? '',
    sellPricePack: s.sellPricePack ?? '',
    priceInstaller: s.priceInstaller?.toString() ?? '',
    priceReseller: s.priceReseller?.toString() ?? '',
    pricePackInstaller: s.pricePackInstaller?.toString() ?? '',
    pricePackReseller: s.pricePackReseller?.toString() ?? '',
    stockIn: 'pack',
    initialBuyPrice: '',
  };
}

const MODE_QUESTIONS: { value: SparepartMode; title: string; example: string }[] = [
  { value: 'biasa', title: 'Per biji atau satu ukuran saja', example: 'Contoh: kapasitor, bracket' },
  {
    value: 'gabungan',
    title: 'Bisa utuh atau diecer, sisa tiap tabung/roll dicatat',
    example: 'Contoh: freon per tabung atau per kg, pipa roll',
  },
  {
    value: 'konversi',
    title: 'Bisa utuh atau diecer, cukup dihitung totalnya',
    example: 'Contoh: baut per dus atau per biji',
  },
  {
    value: 'gulungan',
    title: 'Hanya diecer, sisa tiap roll dicatat',
    example: 'Contoh: kabel yang tidak pernah dijual satu roll',
  },
];

export default function SparepartPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Sparepart | null>(null);
  const [status, setStatus] = React.useState<MasterDataStatus>('active');
  const [deactivating, setDeactivating] = React.useState<Sparepart | null>(null);
  const [fixing, setFixing] = React.useState<Sparepart | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['spareparts', status],
    queryFn: () => listWithPending(status, (s) => apiClient.get<Sparepart[]>(`/spareparts?status=${s}`)),
  });
  const view = useListView(data, (s) => [s.name, s.sku, s.category, s.unit].join(' '));

  const form = useForm<SparepartFormValues>({
    resolver: zodResolver(sparepartSchema),
    defaultValues: emptyValues,
  });
  const mode = form.watch('trackingMode');
  const packMode = hasPackSale(mode);
  // Label memakai nama satuan yang diketik, bukan "satuan kecil/besar".
  const smallName = form.watch('unit')?.trim() || (packMode ? 'kg/meter' : 'satuan');
  const bigName = form.watch('packUnit')?.trim() || 'tabung/roll';
  // Gudang boleh menambah (harga Ritel saja); ubah & hapus admin saja.
  const role = useRole();
  const isAdmin = role === 'admin';
  const isGudang = role === 'gudang';

  function openCreate() {
    setEditing(null);
    form.reset({ ...emptyValues, hidePrice: isGudang });
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
        sellPrice: Number(values.sellPrice || 0),
        // Kosong = null = hapus harga tipe itu. Harga utuh cuma relevan di
        // mode kemasan; di mode lain dikosongkan.
        priceInstaller: numberOrNull(values.priceInstaller),
        priceReseller: numberOrNull(values.priceReseller),
        pricePackInstaller: pack ? numberOrNull(values.pricePackInstaller) : null,
        pricePackReseller: pack ? numberOrNull(values.pricePackReseller) : null,
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
      // Gudang: semua stok awal lewat Barang Masuk tanpa harga modal.
      if (!pack && !isGudang) {
        const created = await apiClient.post<Sparepart>('/spareparts', { ...base, stock: enteredQty });
        return { sparepart: created, stockInError: null as string | null };
      }
      const created = await apiClient.post<Sparepart>('/spareparts', { ...base, stock: 0 });
      const packSize = pack ? Number(values.packSize) : 1;
      const inPack = pack && values.stockIn === 'pack';
      const baseQty = round2(inPack ? enteredQty * packSize : enteredQty);
      if (!(baseQty > 0)) return { sparepart: created, stockInError: null as string | null };
      const cost = isGudang
        ? {}
        : { buyPrice: round2(Number(values.initialBuyPrice) / (inPack ? packSize : 1)) };
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
            ...cost,
            note: 'Stok awal',
          });
        } else {
          await apiClient.post('/stock/in', {
            kind: 'sparepart',
            refId: created.id,
            qty: baseQty,
            ...cost,
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
        if (!editing && isPendingPrice(result.sparepart)) {
          toast.success('Tersimpan, menunggu harga dari admin.');
          setStatus('all');
        } else {
          toast.success(editing ? 'Sparepart diperbarui.' : 'Sparepart ditambahkan.');
        }
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
            Bahan & komponen servis - freon, pipa, bracket, dsb. Klik baris buat lihat & tambah
            stok.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusFilterSelect value={status} onChange={setStatus} />
          {(isAdmin || isGudang) && (
          <Button onClick={openCreate}>
            <Plus />
            Tambah Sparepart
          </Button>
          )}
        </div>
      </div>

      <SearchBox value={view.search} onChange={view.setSearch} placeholder="Cari nama, SKU, kategori, atau satuan..." />

      {isLoading && <LoadingBlock label="Memuat sparepart" />}
      {isError && <ErrorBlock title="Gagal memuat data sparepart" detail="Periksa koneksi internet, lalu muat ulang halaman." />}
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
        <div className={panelClass}>
          <PanelTitle title="Daftar Sparepart" count={view.total} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>SKU / Kategori</TableHead>
                {!isGudang && <TableHead>Harga Jual</TableHead>}
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
                      <Link
                        href={`/master/sparepart/${s.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {s.name}
                      </Link>
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
                  {!isGudang && (
                    <TableCell>
                      {hasPackSale(s.trackingMode) ? (
                        <div className="leading-tight">
                          <div>
                            {Number(s.sellPricePack) > 0 ? formatRupiah(s.sellPricePack!) : 'Belum diisi'}
                            <span className="text-xs text-muted-foreground"> / {s.packUnit}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {Number(s.sellPrice) > 0 ? formatRupiah(s.sellPrice) : 'Belum diisi'} / {s.unit}
                          </div>
                        </div>
                      ) : (
                        <>
                          {formatRupiah(s.sellPrice)}
                          <span className="text-xs text-muted-foreground"> / {s.unit}</span>
                        </>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    {formatStock(s)}
                    {/* "1 rol" saja tidak memberi tahu berapa meter/kg-nya. */}
                    {formatStock(s) !== `${Number(s.stock)} ${s.unit}` && (
                      <span className="block text-xs text-muted-foreground">
                        = {Number(s.stock)} {s.unit}
                      </span>
                    )}
                    {s.reserved ? (
                      <span className="block text-xs text-muted-foreground">
                        {s.reserved} {s.unit} dipesan teknisi
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.active ? 'success' : 'secondary'}>
                      {s.active ? 'Aktif' : isPendingPrice(s) ? 'Menunggu harga' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {isAdmin && (
                        <>
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
                        </>
                      )}
                      {isGudang && (
                        <Button variant="ghost" size="icon" title="Koreksi stok" asChild>
                          <Link href={`/stock/opname?refId=${s.id}`} onClick={(e) => e.stopPropagation()}>
                            <ClipboardCheck className="size-4" />
                          </Link>
                        </Button>
                      )}
                      {isGudang && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFixing(s);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
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
                ? 'Ubah data sparepart. Stok tidak diubah dari sini - klik baris di tabel buat tambah stok.'
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
                    Isi kemasan cuma contoh umum - sesuaikan dengan barang yang kamu beli.
                  </p>
                </div>
              )}
              <FormField
                control={form.control}
                name="trackingMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Barang ini dijual bagaimana?</FormLabel>
                    <div role="radiogroup" className="grid gap-2">
                      {MODE_QUESTIONS.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          role="radio"
                          aria-checked={field.value === m.value}
                          onClick={() => {
                            field.onChange(m.value);
                            // Mode per-gulungan wajib mulai dari stok 0 (lihat
                            // SparepartsService.create) — paksa biar gak nyangkut.
                            if (m.value === 'gulungan') form.setValue('stock', '0');
                          }}
                          className={`rounded-md border p-3 text-left ${
                            field.value === m.value ? 'border-primary bg-primary/10' : 'hover:bg-muted'
                          }`}
                        >
                          <span className="block font-medium">{m.title}</span>
                          <span className="block text-sm text-muted-foreground">{m.example}</span>
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {packMode ? (
                <div className="grid gap-2 rounded-md border p-3">
                  <p className="font-medium">
                    1 {bigName} berisi {form.watch('packSize') || '…'} {smallName}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <FormField
                    control={form.control}
                    name="packUnit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Wadahnya</FormLabel>
                        <FormControl>
                          <Input placeholder="tabung, roll, dus" list="satuan-wadah" {...field} />
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
                        <FormLabel>Isinya berapa?</FormLabel>
                        <FormControl>
                          <Input placeholder="10" inputMode="decimal" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                    <FormField
                    control={form.control}
                    name="unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Satuan isinya</FormLabel>
                        <FormControl>
                          <Input placeholder="kg, meter, pcs" list="satuan-isi" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  </div>
                </div>
              ) : (
                <FormField
                    control={form.control}
                    name="unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Satuannya apa?</FormLabel>
                        <FormControl>
                          <Input placeholder="pcs, kg, meter, set" list="satuan-isi" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
              )}
              <datalist id="satuan-wadah">
                <option value="tabung" />
                <option value="roll" />
                <option value="dus" />
              </datalist>
              <datalist id="satuan-isi">
                <option value="kg" />
                <option value="meter" />
                <option value="pcs" />
                <option value="liter" />
              </datalist>
              {isGudang && (
                <p className="text-sm text-muted-foreground">
                  Harga diisi admin. Barang belum bisa dijual sampai admin mengisinya.
                </p>
              )}
              {!isGudang && (
                <div className={packMode ? 'grid grid-cols-2 gap-4' : 'grid gap-4'}>
                  <FormField
                    control={form.control}
                    name="sellPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {packMode ? `Harga jual per ${smallName}` : 'Harga jual'}
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
                            Harga jual 1 {bigName} utuh
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
              )}
              {/* Harga per tipe pembeli (2026-10-13) — opsional. Harga di atas
                  = harga Ritel. Kosong = member tipe itu tidak bisa membeli
                  sparepart ini. */}
              {!isGudang && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer font-medium">
                  Harga Installer &amp; Reseller (boleh dikosongkan)
                </summary>
                <div className="mt-3 grid gap-4">
              {(['Installer', 'Reseller'] as const).map((tier) => (
                <div key={tier} className={packMode ? 'grid grid-cols-2 gap-4' : 'grid gap-4'}>
                  <FormField
                    control={form.control}
                    name={`price${tier}`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{packMode ? `Harga ${tier} per ${smallName}` : `Harga ${tier}`}</FormLabel>
                        <FormControl>
                          <CurrencyInput {...field} placeholder="Belum diisi" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {packMode && (
                    <FormField
                      control={form.control}
                      name={`pricePack${tier}`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Harga {tier} per {bigName}</FormLabel>
                          <FormControl>
                            <CurrencyInput {...field} placeholder="Belum diisi" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              ))}
                </div>
              </details>
              )}
              {!editing &&
                (mode === 'gulungan' ? (
                  <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    Stok awalnya diisi sesudah barang ini disimpan, lewat Barang Masuk
                    (satu per satu panjang tiap gulungan).
                  </p>
                ) : packMode ? (
                  <InitialStockPack form={form} />
                ) : (
                  <FormField
                    control={form.control}
                    name="stock"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Stok yang ada sekarang ({smallName})</FormLabel>
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

      {fixing && (
        <FixPendingDialog
          path={`/spareparts/${fixing.id}`}
          item={fixing}
          withSku
          onClose={() => setFixing(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['spareparts'] })}
        />
      )}

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
  const unit = form.watch('unit')?.trim() || 'kg/meter';
  const packUnit = form.watch('packUnit')?.trim() || 'tabung/roll';
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
            <FormLabel>Stok yang ada sekarang, mau dihitung per apa?</FormLabel>
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
            <FormLabel>Berapa {inPack ? packUnit : unit}?</FormLabel>
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
      {qty > 0 && !form.watch('hidePrice') && (
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
