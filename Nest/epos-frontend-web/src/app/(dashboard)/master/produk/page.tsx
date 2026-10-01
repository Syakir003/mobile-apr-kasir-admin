'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ChevronRight, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import {
  requiredNumberField,
  optionalIntField,
  optionalNumberField,
  trimmedOrUndefined,
  numberOrUndefined,
} from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusFilterSelect, type MasterDataStatus } from '@/components/master-data/status-filter-select';
import { DeactivateDialog } from '@/components/master-data/deactivate-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CurrencyInput } from '@/components/ui/currency-input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Padanan model Product Prisma (products.controller.ts / schema.prisma).
// `pk`/`sellPrice` DECIMAL -> Prisma Decimal -> string lewat JSON. `stock`
// BUKAN kolom asli (agregat dari batch item_costs via
// ProductsService.stockFor, dikirim backend sebagai field tambahan di
// respons GET). `sellPrice` KEBALIKAN — kolom ASLI lagi (Siklus
// harga-seragam 2026-09-22), satu harga jual seragam per produk.
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
  sellPrice: string;
  description: string | null;
  category: string | null;
  active: boolean;
  // BARU (Point 2, 2026-09-23) — AC Indoor/Outdoor Berpasangan. Diisi HANYA
  // di sisi Indoor. `pairedProduct` (nama pasangan, buat tampilan) datang
  // dari `include` di ProductsService.findAll/findOne — gak perlu fetch
  // terpisah.
  pairedProductId: string | null;
  pairedProduct: { id: string; name: string } | null;
  // BARU (Paket AC Split, 2026-09-30) — peran unit AC. Produk berpasangan
  // otomatis 'indoor'/'outdoor' (dijaga server); produk "Indoor saja"/
  // "Outdoor saja" diisi dari Jenis Input; produk lama bisa null.
  acRole: 'indoor' | 'outdoor' | null;
}

// BARU (Paket AC Split, 2026-09-30) — stok awal opsional pas Tambah Produk
// (dikelola di luar RHF, sama pola kayak OutdoorDraft). Kalau ada qty > 0,
// abis produk kebuat langsung dicatat barang masuk pertamanya (POST
// /stock/in, mode paket buat Split) biar QR tiap unit langsung kebentuk.
// Supplier SENGAJA gak ada di sini (cuma di form Barang Masuk halaman
// detail produk).
interface InitialStockDraft {
  indoorQty: string; // Split: jumlah Indoor. Indoor/Outdoor saja: jumlah unit.
  outdoorQty: string; // Split doang.
  buyPrice: string; // Split: modal PAKET. Indoor/Outdoor saja: modal unit.
}
const emptyInitialStock: InitialStockDraft = { indoorQty: '', outdoorQty: '', buyPrice: '' };

function parseQty(v: string): number {
  return v.trim() === '' ? 0 : Number(v);
}

const productSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  brand: z.string().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  // FIX (2026-09-29, respons feedback user) — PK sebelumnya wajib diisi,
  // padahal yang wajib cuma Nama & Harga Jual. Field lain (Merek, Tipe,
  // Kategori, BTU, Watt, Garansi, Deskripsi) udah opsional dari awal — PK
  // ikutan dibikin opsional biar konsisten, bisa dilengkapi belakangan
  // lewat Edit.
  pk: optionalNumberField,
  inverter: z.boolean(),
  btu: optionalIntField,
  watt: optionalIntField,
  warranty: z.string().optional(),
  description: z.string().optional(),
  sellPrice: requiredNumberField('Harga jual wajib diisi'),
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
  sellPrice: '',
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
    sellPrice: p.sellPrice,
    active: p.active,
  };
}

// BARU (2026-09-25) — form gabungan Indoor+Outdoor. Field Outdoor ringkas
// (cuma Nama, sisanya dilengkapi belakangan lewat Edit) gak dikelola
// react-hook-form kayak field Indoor — disimpan terpisah di sini biar
// gampang di-skip/reset independen dari validasi form Indoor utama.
//
// SIMPLIFIKASI (audit 2026-09-29, respons ke pertanyaan user "kok harga
// jualnya input 2x?") — sebelumnya section ini juga punya field "Harga
// Jual Outdoor" sendiri, yang bikin bingung karena keliatan kayak 2 harga
// per 1 unit AC padahal harga jual "Unit Lengkap" di POS 100% nempel di
// Harga Jual Indoor (baris Outdoor SELALU ditimpa jadi 0 pas dijual
// sepasang — lihat PosService). Field harga di sini DIHAPUS — Outdoor
// baru SELALU dibuat dengan sellPrice=0 otomatis (gak perlu diisi/dilihat
// admin sama sekali di form ini). Kalau memang ada kasus Outdoor-nya perlu
// dijual TERPISAH dengan harga sendiri (mis. ganti unit outdoor doang),
// admin atur harga itu belakangan lewat "Edit" di row Outdoor nested
// (tabel Master Data Produk) — itu form Edit produk biasa yang tetap
// punya field Harga Jual penuh.
interface OutdoorDraft {
  /** Id produk Outdoor kalau lagi edit produk yang UDAH punya pasangan (buat PATCH). undefined = pasangan baru/belum ada (buat POST). */
  id?: string;
  name: string;
}
const emptyOutdoorDraft: OutdoorDraft = { id: undefined, name: '' };

// FIX (audit 2026-09-29) — best-effort compensasi kalau Outdoor udah
// kebuat (POST sukses) tapi langkah berikutnya (PATCH/POST Indoor) gagal.
// Gak ada hard-delete produk di sistem ini (cuma soft-delete/nonaktifkan),
// jadi compensasi-nya nonaktifin Outdoor yang nyangkut itu biar gak
// nongol sebagai produk standalone aktif tanpa pasangan. Pesan error yang
// dibalikin jujur soal berhasil/gagalnya compensasi ini sendiri.
async function withOrphanCleanup(orphanId: string, originalErr: unknown): Promise<Error> {
  const originalMessage =
    originalErr instanceof ApiError
      ? originalErr.message
      : originalErr instanceof Error
        ? originalErr.message
        : 'Gagal menyimpan produk';
  const cleaned = await apiClient
    .patch(`/products/${orphanId}`, { active: false })
    .then(() => true)
    .catch(() => false);
  return new Error(
    cleaned
      ? `${originalMessage} — Outdoor yang sempat kebuat udah otomatis dinonaktifkan (cek filter status "Nonaktif"), coba simpan ulang.`
      : `${originalMessage} — DAN Outdoor yang sempat kebuat GAGAL dinonaktifkan otomatis. Cek & nonaktifkan manual lewat tabel Master Data Produk.`,
  );
}

// FIX (audit 2026-09-29) — sebelumnya dialog nonaktifkan cuma warning soal
// stok, gak ada info sama sekali kalau produk yang mau dinonaktifkan lagi
// berpasangan (Indoor/Outdoor). Nonaktifin salah satu gak otomatis
// nonaktifin pasangannya (sengaja gitu — beda status Aktif/Nonaktif per
// produk itu valid, mis. Outdoor rusak diganti tapi Indoor lama masih
// dipakai), tapi admin perlu TAU biar gak nonaktifin kepencet tanpa sadar
// dampaknya ke pasangannya. `allProducts` yang dilempar di sini adalah list
// hasil fetch dengan filter status YANG LAGI AKTIF di halaman — kalau
// pasangannya kebetulan udah nonaktif duluan (jadi gak lolos filter
// 'active'), pengecekan sisi "aku Outdoor-nya siapa" di bawah bisa gak
// ketemu; itu batasan yang bisa diterima buat warning tambahan begini
// (bukan validasi keras).
function buildDeactivateWarning(product: Product, allProducts: Product[] | undefined): string | undefined {
  const parts: string[] = [];
  if (product.stock > 0) {
    parts.push(`Produk ini masih punya stok ${product.stock} unit.`);
  }
  if (product.pairedProduct) {
    parts.push(
      `Produk ini berpasangan sama Outdoor "${product.pairedProduct.name}" — pasangannya TETAP aktif, gak ikut kenonaktifin.`,
    );
  } else {
    const claimedBy = (allProducts ?? []).find((p) => p.pairedProductId === product.id);
    if (claimedBy) {
      parts.push(
        `Produk ini adalah Outdoor pasangan "${claimedBy.name}" — Indoor-nya TETAP aktif, gak ikut kenonaktifin.`,
      );
    }
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export default function ProdukPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [status, setStatus] = React.useState<MasterDataStatus>('active');
  const [deactivating, setDeactivating] = React.useState<Product | null>(null);
  // BARU (2026-09-25) — pilihan jenis input pas Tambah Produk: unit tunggal
  // (Indoor/Outdoor) atau Split (dua-duanya sekaligus, langsung kepasangkan).
  const [mode, setMode] = React.useState<'indoor' | 'outdoor' | 'split'>('indoor');
  const [outdoorDraft, setOutdoorDraft] = React.useState<OutdoorDraft>(emptyOutdoorDraft);
  const [outdoorLoading, setOutdoorLoading] = React.useState(false);
  const [initialStock, setInitialStock] = React.useState<InitialStockDraft>(emptyInitialStock);
  // Peran unit pas Edit — cuma bisa diubah buat produk yang GAK berpasangan.
  const [roleDraft, setRoleDraft] = React.useState<'indoor' | 'outdoor' | 'none'>('none');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['products', status],
    queryFn: () => apiClient.get<Product[]>(`/products?status=${status}`),
  });

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: emptyValues,
  });

  // Paket AC Split (2026-09-30) — peran unit produk yang lagi diedit cuma
  // bisa diubah kalau produk itu GAK berpasangan (bukan Indoor sebuah
  // paket, bukan juga Outdoor-nya).
  const editingIsPairTarget = !!editing && (data ?? []).some((p) => p.pairedProductId === editing.id);
  const editingRoleEditable = !!editing && !editing.pairedProductId && !editingIsPairTarget;

  function openCreate() {
    setEditing(null);
    form.reset(emptyValues);
    setMode('indoor');
    setOutdoorDraft(emptyOutdoorDraft);
    setInitialStock(emptyInitialStock);
    setDialogOpen(true);
  }

  // BARU (2026-09-25) — form gabungan: kalau produk yang diedit udah punya
  // pasangan Outdoor, fetch data Outdoor-nya buat ngisi section ringkas di
  // bawah form (bukan dropdown lagi). Async karena butuh 1x GET tambahan.
  async function openEdit(p: Product) {
    setEditing(p);
    form.reset(toFormValues(p));
    setRoleDraft(p.acRole ?? 'none');
    setDialogOpen(true);
    if (p.pairedProductId) {
      setOutdoorLoading(true);
      setOutdoorDraft({ id: p.pairedProductId, name: '' });
      try {
        const outdoor = await apiClient.get<Product>(`/products/${p.pairedProductId}`);
        setOutdoorDraft({ id: outdoor.id, name: outdoor.name });
      } catch {
        toast.error('Gagal memuat data Outdoor pasangan.');
      } finally {
        setOutdoorLoading(false);
      }
    } else {
      setOutdoorDraft(emptyOutdoorDraft);
    }
  }

  const saveMutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const base = {
        name: values.name.trim(),
        brand: trimmedOrUndefined(values.brand),
        type: trimmedOrUndefined(values.type),
        category: trimmedOrUndefined(values.category),
        // FIX (2026-09-29) — PK sekarang opsional (lihat productSchema),
        // jadi gak boleh lagi `Number(values.pk)` polos (kosong -> NaN
        // dikirim, atau ngaco jadi 0). Pola sama kayak btu/watt: kosong ->
        // field-nya di-drop total dari payload.
        pk: numberOrUndefined(values.pk),
        inverter: values.inverter,
        btu: numberOrUndefined(values.btu),
        watt: numberOrUndefined(values.watt),
        warranty: trimmedOrUndefined(values.warranty),
        description: trimmedOrUndefined(values.description),
        // Siklus harga-seragam (2026-09-22) — sellPrice SEKARANG dikirim di
        // create MAUPUN update (dulu sengaja di-skip di update karena
        // harga diatur lewat stock-in per-batch; sekarang Master Data ini
        // satu-satunya tempat atur harga jual produk).
        sellPrice: Number(values.sellPrice),
      };

      if (editing) {
        // Form gabungan (2026-09-25) — section Outdoor ringkas diproses
        // bareng PATCH Indoor-nya, gantiin dropdown "Pasangan Outdoor" lama.
        // Nama Outdoor kosong = gak nyentuh pairing sama sekali (biarin
        // seperti sebelumnya). Nama keisi + udah ada id = update Outdoor
        // yang ada. Nama keisi + belum ada id = bikin Outdoor baru & baru
        // pasangkan (pairedProductId baru dikirim di kasus ini).
        let pairedProductId: string | undefined;
        // FIX (audit 2026-09-29) — ini 2 HTTP call terpisah, BUKAN 1
        // transaksi. Kalau Outdoor-nya baru kebuat (POST, bukan PATCH ke
        // yang udah ada) terus PATCH Indoor di bawah gagal, Outdoor itu
        // nyangkut sendirian tanpa pasangan. `orphanCandidateId` nandain
        // kasus itu doang (PATCH ke Outdoor yang UDAH ada gak dianggap
        // "baru dibuat" — itu emang edit yang valid berdiri sendiri).
        let orphanCandidateId: string | undefined;
        if (outdoorDraft.name.trim()) {
          if (outdoorDraft.id) {
            // Outdoor UDAH ada — cuma update nama-nya, sellPrice existing
            // gak disentuh (form ini emang gak punya kolom harga lagi).
            await apiClient.patch<Product>(`/products/${outdoorDraft.id}`, {
              name: outdoorDraft.name.trim(),
            });
          } else {
            // Outdoor baru — sellPrice WAJIB dikirim (required di
            // CreateProductDto), selalu 0 (lihat komentar di atas
            // `interface OutdoorDraft`).
            const createdOutdoor = await apiClient.post<Product>('/products', {
              name: outdoorDraft.name.trim(),
              sellPrice: 0,
            });
            pairedProductId = createdOutdoor.id;
            orphanCandidateId = createdOutdoor.id;
          }
        }
        try {
          // Stok TETAP gak dikirim di update — satu-satunya jalur ubah itu
          // StockService.stockIn() (halaman detail produk, klik baris tabel).
          return await apiClient.patch<Product>(`/products/${editing.id}`, {
            ...base,
            active: values.active,
            ...(pairedProductId ? { pairedProductId } : {}),
            // Paket AC Split (2026-09-30) — peran cuma dikirim buat produk
            // yang gak berpasangan (yang berpasangan dikunci server).
            ...(editingRoleEditable && !pairedProductId
              ? { acRole: roleDraft === 'none' ? null : roleDraft }
              : {}),
          });
        } catch (err) {
          if (orphanCandidateId) throw await withOrphanCleanup(orphanCandidateId, err);
          throw err;
        }
      }

      // BARU (2026-09-25) — mode Split: bikin Outdoor ringkas DULU (biar
      // dapet id-nya), baru Indoor-nya nunjuk pairedProductId ke situ dalam
      // satu submit. Mode Indoor/Outdoor tunggal tetap POST satu produk aja.
      if (mode === 'split') {
        const outdoor = await apiClient.post<Product>('/products', {
          name: outdoorDraft.name.trim(),
          sellPrice: 0,
          acRole: 'outdoor',
        });
        let indoor: Product;
        try {
          indoor = await apiClient.post<Product>('/products', { ...base, pairedProductId: outdoor.id });
        } catch (err) {
          throw await withOrphanCleanup(outdoor.id, err);
        }
        await recordInitialStock(indoor.id, outdoor.id);
        return indoor;
      }
      // Indoor saja / Outdoor saja — peran ikut Jenis Input.
      const created = await apiClient.post<Product>('/products', { ...base, acRole: mode });
      await recordInitialStock(created.id, null);
      return created;
    },
    onSuccess: (product, values) => {
      toast.success(editing ? 'Produk diperbarui.' : 'Produk ditambahkan.');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setDialogOpen(false);
      if (!editing && initialTotalQty === 0) {
        toast.info(`Klik baris "${values.name}" di tabel buat isi stok pertamanya.`);
      }
    },
    onError: (err) => {
      // `instanceof Error` (bukan cuma `instanceof ApiError`) — withOrphanCleanup()
      // di atas ngelempar `Error` biasa yang isinya pesan compensasi orphan,
      // bukan ApiError dari backend. ApiError sendiri extends Error, jadi
      // cek ini tetap nyakup pesan error backend yang biasa juga.
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan produk.');
    },
  });

  // Paket AC Split (2026-09-30) — stok awal (opsional) dicatat sebagai
  // barang masuk pertama abis produk kebuat. Ini HTTP call terpisah (bukan
  // 1 transaksi sama pembuatan produk) — kalau gagal, produknya TETAP
  // kebuat (gak di-rollback), admin dikasih tau buat isi stok lewat halaman
  // detail. `confirmOverride: true` karena peringatan modal >= harga jual
  // udah ditampilin langsung di form (lihat initialBelowCost) sebelum
  // admin klik Simpan.
  const initialIndoorQty = parseQty(initialStock.indoorQty);
  const initialOutdoorQty = mode === 'split' ? parseQty(initialStock.outdoorQty) : 0;
  const initialTotalQty = (initialIndoorQty || 0) + (initialOutdoorQty || 0);
  const watchedSellPrice = form.watch('sellPrice');
  const initialBelowCost =
    initialTotalQty > 0 &&
    initialStock.buyPrice.trim() !== '' &&
    Number(initialStock.buyPrice) >= Number(watchedSellPrice || 0);

  async function recordInitialStock(productId: string, outdoorId: string | null) {
    if (initialTotalQty === 0) return;
    try {
      if (outdoorId) {
        await apiClient.post('/stock/in', {
          kind: 'product',
          refId: productId,
          qty: initialIndoorQty,
          outdoorQty: initialOutdoorQty,
          pairMode: 'lengkap',
          outdoorRefId: outdoorId,
          buyPrice: Number(initialStock.buyPrice),
          note: 'Stok awal',
          confirmOverride: true,
        });
      } else {
        await apiClient.post('/stock/in', {
          kind: 'product',
          refId: productId,
          qty: initialIndoorQty,
          buyPrice: Number(initialStock.buyPrice),
          note: 'Stok awal',
          confirmOverride: true,
        });
      }
      toast.success('Stok awal tersimpan — QR tiap unit bisa dicetak dari halaman detail produk.');
    } catch (err) {
      toast.error(
        `Produk kebuat, tapi stok awal gagal disimpan (${err instanceof Error ? err.message : 'error'}). Isi lewat halaman detail produk.`,
      );
    }
  }

  // Validasi stok awal: qty bilangan bulat >= 0; Split: Indoor minimal 1
  // kalau ada stok awal (modal paket nempel di batch Indoor); modal wajib
  // kalau ada qty > 0.
  function validateInitialStock(): boolean {
    if (editing) return true;
    const qtys = [initialIndoorQty, initialOutdoorQty];
    if (qtys.some((q) => !Number.isInteger(q) || q < 0)) {
      toast.error('Stok awal harus bilangan bulat (boleh kosong/0).');
      return false;
    }
    if (mode === 'split' && initialOutdoorQty > 0 && initialIndoorQty === 0) {
      toast.error('Stok awal Indoor minimal 1 kalau ada stok awal Outdoor (modal paket nempel di Indoor).');
      return false;
    }
    if (initialTotalQty > 0 && !(Number(initialStock.buyPrice) > 0)) {
      toast.error(mode === 'split' ? 'Modal paket wajib diisi kalau ada stok awal.' : 'Modal wajib diisi kalau ada stok awal.');
      return false;
    }
    return true;
  }

  // BARU (2026-09-25) — validasi manual section Outdoor ringkas (di luar
  // zod schema react-hook-form karena fieldnya emang gak dikelola RHF).
  // Mode Split -> Nama Outdoor wajib diisi dari awal. Validasi harga UDAH
  // GAK ADA LAGI (audit 2026-09-29) — form ini gak punya field harga buat
  // Outdoor sama sekali sekarang, sellPrice-nya selalu 0 otomatis.
  function validateOutdoorDraft(): boolean {
    if (!editing && mode === 'split' && !outdoorDraft.name.trim()) {
      toast.error('Nama unit Outdoor wajib diisi buat mode Split.');
      return false;
    }
    return true;
  }

  function onSubmit(values: ProductFormValues) {
    if (!validateOutdoorDraft()) return;
    if (!validateInitialStock()) return;
    saveMutation.mutate(values);
  }

  const toggleActiveMutation = useMutation({
    mutationFn: (p: Product) =>
      apiClient.patch<Product>(`/products/${p.id}`, { active: !p.active }),
    onSuccess: (_data, p) => {
      toast.success(p.active ? 'Produk dinonaktifkan.' : 'Produk diaktifkan kembali.');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setDeactivating(null);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengubah status produk.');
    },
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produk AC</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Katalog unit AC yang dijual di POS. Klik baris buat lihat batch & tambah stok.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusFilterSelect value={status} onChange={setStatus} />
          <Button onClick={openCreate}>
            <Plus />
            Tambah Produk
          </Button>
        </div>
      </div>

      <ProductTable
        products={data}
        isLoading={isLoading}
        isError={isError}
        onEdit={openEdit}
        onDeactivate={setDeactivating}
        onRowClick={(p) => router.push(`/master/produk/${p.id}`)}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Produk' : 'Tambah Produk'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Ubah identitas, spesifikasi & harga jual produk. Stok diatur lewat halaman detail (klik baris di tabel).'
                : 'Isi identitas, spesifikasi & harga jual produk baru. Stok awal (opsional) bisa langsung diisi di bagian bawah — stok berikutnya lewat halaman detail (klik baris di tabel).'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
              {!editing && (
                <div className="grid gap-2">
                  <Label htmlFor="mode-select">Jenis Input</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                    <SelectTrigger id="mode-select" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="indoor">Indoor (unit tunggal)</SelectItem>
                      <SelectItem value="outdoor">Outdoor (unit tunggal)</SelectItem>
                      <SelectItem value="split">Split — Indoor + Outdoor sekaligus</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Pilih &ldquo;Split&rdquo; kalau unit ini AC 2-komponen — Indoor &amp; Outdoor
                    langsung dibikin &amp; dipasangkan sekali submit, jadi 1 Produk AC (paket).
                  </p>
                </div>
              )}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {(!editing && mode === 'split') || editing?.pairedProductId ? 'Nama Unit Indoor' : 'Nama'}
                    </FormLabel>
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
              <FormField
                control={form.control}
                name="sellPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {(!editing && mode === 'split') || editing?.pairedProductId
                        ? 'Harga Jual Paket (Split)'
                        : 'Harga Jual'}
                    </FormLabel>
                    <FormControl>
                      <CurrencyInput {...field} />
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
              {/* BARU (2026-09-25) — ganti dropdown "Pasangan Outdoor" lama.
                  Pas Tambah Produk mode Split, atau pas Edit produk apa aja
                  (form gabungan) — section ringkas ini yang nge-handle bikin
                  atau update pasangan Outdoor-nya, gak lagi milih dari
                  dropdown produk yang udah ada. */}
              {((!editing && mode === 'split') || (editing && !editingIsPairTarget)) && (
                <div className="grid gap-3 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Unit Outdoor Pasangan</p>
                    <p className="text-xs text-muted-foreground">
                      {editing
                        ? outdoorDraft.id
                          ? 'Produk ini punya pasangan Outdoor — ubah namanya di sini kalau perlu. Harga jualnya diatur terpisah lewat Edit produk Outdoor itu sendiri (klik badge "Berpasangan" di tabel buat buka row-nya).'
                          : 'Kosongkan kalau produk ini gak punya pasangan Outdoor. Isi buat bikin & pasangkan Outdoor baru.'
                        : 'Isi nama unit Outdoor-nya. Detail lain (merek, PK, BTU, harga jual, dst) bisa dilengkapi belakangan lewat Edit.'}
                    </p>
                  </div>
                  {outdoorLoading ? (
                    <p className="text-sm text-muted-foreground">Memuat data Outdoor...</p>
                  ) : (
                    <div className="grid gap-2">
                      <Label htmlFor="outdoor-name">Nama Outdoor</Label>
                      <Input
                        id="outdoor-name"
                        placeholder="Contoh: Daikin RZF25 Outdoor"
                        value={outdoorDraft.name}
                        onChange={(e) =>
                          setOutdoorDraft((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                      {/* Klarifikasi harga (2026-09-25, disederhanakan
                          2026-09-29 — field Harga Jual Outdoor DIHAPUS dari
                          form ini, cuma 1x input harga sekarang: Harga Jual
                          Indoor di atas). Nyambung ke logika PosService:
                          baris Outdoor mode "Unit Lengkap" SELALU ditimpa
                          harga 0 pas checkout, harga jual satu unit lengkap
                          nempel 100% di Harga Jual Indoor di atas. */}
                      {/* Paket AC Split (2026-09-30) — unit satuan dari
                          paket (Indoor/Outdoor saja) harganya diisi kasir
                          pas checkout, bukan harga baku di Master Data. */}
                      <p className="text-xs text-muted-foreground">
                        Harga jual gak perlu diisi di sini — harga jual <strong>satu paket AC
                        (Split)</strong> 100% ditentukan dari <strong>Harga Jual Paket</strong> di
                        atas. Kalau nanti Indoor atau Outdoor-nya dijual satuan (mis. ganti unit
                        outdoor doang), harganya diisi kasir langsung pas checkout di POS.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* BARU (Paket AC Split, 2026-09-30) — stok awal opsional,
                  langsung jadi barang masuk pertama (QR per unit kebentuk).
                  Supplier sengaja gak ada di sini (cuma di Barang Masuk). */}
              {!editing && (
                <div className="grid gap-3 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Stok Awal (opsional)</p>
                    <p className="text-xs text-muted-foreground">
                      {mode === 'split'
                        ? 'Isi jumlah tiap unit yang udah ada di gudang. Modal diisi 1 angka per paket (Indoor + Outdoor). Kosongin kalau belum ada stok.'
                        : 'Isi jumlah unit yang udah ada di gudang. Kosongin kalau belum ada stok.'}
                    </p>
                  </div>
                  {mode === 'split' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="initial-indoor">Stok awal Indoor</Label>
                        <Input
                          id="initial-indoor"
                          inputMode="numeric"
                          placeholder="0"
                          value={initialStock.indoorQty}
                          onChange={(e) => setInitialStock((prev) => ({ ...prev, indoorQty: e.target.value }))}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="initial-outdoor">Stok awal Outdoor</Label>
                        <Input
                          id="initial-outdoor"
                          inputMode="numeric"
                          placeholder="0"
                          value={initialStock.outdoorQty}
                          onChange={(e) => setInitialStock((prev) => ({ ...prev, outdoorQty: e.target.value }))}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <Label htmlFor="initial-qty">Stok awal</Label>
                      <Input
                        id="initial-qty"
                        inputMode="numeric"
                        placeholder="0"
                        value={initialStock.indoorQty}
                        onChange={(e) => setInitialStock((prev) => ({ ...prev, indoorQty: e.target.value }))}
                      />
                    </div>
                  )}
                  {initialTotalQty > 0 && (
                    <div className="grid gap-2">
                      <Label htmlFor="initial-buy-price">
                        {mode === 'split' ? 'Modal Paket (Indoor + Outdoor)' : 'Modal'}
                      </Label>
                      <CurrencyInput
                        id="initial-buy-price"
                        value={initialStock.buyPrice}
                        onChange={(v) => setInitialStock((prev) => ({ ...prev, buyPrice: v }))}
                      />
                      {initialBelowCost && (
                        <p className="text-xs text-destructive">
                          Modal sama/lebih besar dari harga jual — tetap bisa disimpan, cek lagi angkanya.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {editing && editingRoleEditable && (
                <div className="grid gap-2">
                  <Label htmlFor="role-select">Peran Unit</Label>
                  <Select value={roleDraft} onValueChange={(v) => setRoleDraft(v as typeof roleDraft)}>
                    <SelectTrigger id="role-select" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="indoor">Indoor</SelectItem>
                      <SelectItem value="outdoor">Outdoor</SelectItem>
                      <SelectItem value="none">Belum ditentukan</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Nentuin produk ini muncul di tab Indoor atau Outdoor di Kasir (POS).
                  </p>
                </div>
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

      {deactivating && (
        <DeactivateDialog
          open={!!deactivating}
          onOpenChange={(open) => !open && setDeactivating(null)}
          itemName={deactivating.name}
          willActivate={!deactivating.active}
          stockWarning={buildDeactivateWarning(deactivating, data)}
          onConfirm={() => toggleActiveMutation.mutate(deactivating)}
          isPending={toggleActiveMutation.isPending}
        />
      )}
    </div>
  );
}

function ProductTable({
  products,
  isLoading,
  isError,
  onEdit,
  onDeactivate,
  onRowClick,
}: {
  products: Product[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onEdit: (p: Product) => void;
  onDeactivate: (p: Product) => void;
  onRowClick: (p: Product) => void;
}) {
  // BARU (Point 2, 2026-09-23) — produk yang jadi TARGET pairedProductId
  // produk lain (sisi Outdoor) di-nested di bawah baris Indoor-nya, bukan
  // tampil sebagai baris sendiri di list utama (klarifikasi 2026-09-23:
  // ini MURNI tampilan/pengelompokan, Outdoor TETAP full Product independen
  // — tetap searchable/sellable sendiri di POS/Barang Masuk, cuma gak
  // nongol di sini sebagai row terpisah). Hook ini WAJIB dipanggil sebelum
  // early-return di bawah (Rules of Hooks).
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const pairedOutdoorIds = React.useMemo(
    () => new Set((products ?? []).filter((p) => p.pairedProductId).map((p) => p.pairedProductId as string)),
    [products],
  );
  const topLevelProducts = React.useMemo(
    () => (products ?? []).filter((p) => !pairedOutdoorIds.has(p.id)),
    [products, pairedOutdoorIds],
  );
  // FIX (audit 2026-09-29) — sebelumnya map ini di-key pake id si Outdoor
  // sendiri, padahal cara nyarinya (di bawah) pake id si Indoor. Akibatnya
  // outdoor SELALU `undefined` buat pasangan manapun (klik badge
  // "Berpasangan" gak pernah nampilin apa-apa). Sekarang di-key pake id
  // SEMUA produk (bukan cuma yang keidentifikasi Outdoor), terus dicari
  // pake `p.pairedProductId` (field yang nunjuk ke Outdoor-nya, ada di
  // objek si Indoor) — lihat pemakaian di bawah.
  const productsById = React.useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p] as const)),
    [products],
  );

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
            <TableHead>Stok</TableHead>
            <TableHead>Harga Jual</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {topLevelProducts.map((p) => {
            // `outdoor` cuma ketemu kalau Outdoor pasangannya lolos filter
            // status yang lagi aktif di halaman ini (default 'active'). Kalau
            // `p.pairedProduct` ada (backend selalu nyertain ini apapun
            // filternya) tapi `outdoor` gak ketemu di sini, berarti
            // Outdoor-nya lagi kesaring filter status (mis. udah
            // dinonaktifkan sementara filternya masih 'Aktif') — bukan bug,
            // ditangani lewat pesan di bawah biar gak diem aja.
            const outdoor = p.pairedProductId ? productsById.get(p.pairedProductId) : undefined;
            const isExpanded = expandedId === p.id;
            return (
              <React.Fragment key={p.id}>
                <TableRow className="cursor-pointer" onClick={() => onRowClick(p)}>
                  <TableCell className="text-muted-foreground">{p.sku || '-'}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {p.name}
                      {p.pairedProduct && (
                        <Badge
                          variant="secondary"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(isExpanded ? null : p.id);
                          }}
                        >
                          Berpasangan: {p.pairedProduct.name}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[p.brand, p.type].filter(Boolean).join(' • ') || '-'}
                  </TableCell>
                  <TableCell>
                    {/* Paket AC Split (2026-09-30) — produk paket nampilin
                        stok TIAP unit (Indoor & Outdoor), bukan cuma Indoor. */}
                    {p.pairedProduct && outdoor ? (
                      <p className="whitespace-nowrap">
                        Indoor {p.stock} • Outdoor {outdoor.stock}
                      </p>
                    ) : p.stock > 0 ? (
                      <p>{p.stock} unit</p>
                    ) : (
                      <Badge variant="warning">Belum ada stok</Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatRupiah(p.sellPrice)}</TableCell>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        title={p.active ? 'Nonaktifkan' : 'Aktifkan kembali'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeactivate(p);
                        }}
                      >
                        {p.active ? (
                          <Trash2 className="size-4 text-destructive" />
                        ) : (
                          <RotateCcw className="size-4" />
                        )}
                      </Button>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded && p.pairedProduct && (
                  <TableRow className="bg-muted/30">
                    <TableCell />
                    <TableCell colSpan={5}>
                      {outdoor ? (
                        <div className="flex items-center justify-between gap-2 py-1 pl-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Outdoor: </span>
                            <span className="font-medium">{outdoor.name}</span>
                            <span className="text-muted-foreground">
                              {' '}
                              • {[outdoor.brand, outdoor.type].filter(Boolean).join(' • ') || '-'} •{' '}
                              {outdoor.stock > 0 ? `${outdoor.stock} unit` : 'Belum ada stok'} •{' '}
                              {formatRupiah(outdoor.sellPrice)}
                            </span>
                            {!outdoor.active && (
                              <Badge variant="secondary" className="ml-2">
                                Nonaktif
                              </Badge>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button variant="outline" size="sm" onClick={() => onRowClick(outdoor)}>
                              Lihat batch
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => onEdit(outdoor)}>
                              Edit
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => onDeactivate(outdoor)}>
                              {outdoor.active ? 'Nonaktifkan' : 'Aktifkan'}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="py-1 pl-4 text-sm text-muted-foreground">
                          Outdoor pasangan (&ldquo;{p.pairedProduct.name}&rdquo;) lagi kesaring filter status di
                          atas — ganti ke &ldquo;Semua&rdquo; buat lihat &amp; kelola.
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
