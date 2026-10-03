'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Minus, Package, Plus, Search, ShoppingCart, Ticket, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { optionalNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { Button } from '@/components/ui/button';
import { MemberPicker } from '@/components/member-picker';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatStock, hasPackSale, type SparepartMode } from '@/lib/sparepart-mode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

// Item picker (Produk/Sparepart/Jasa) + keranjang di satu halaman, BUKAN dua
// layar terpisah kayak Flutter (bottom sheet -> /pos/checkout) — layar lebar
// punya ruang buat nampilin semuanya sekaligus, jadi kasir gak perlu
// bolak-balik. Alur bisnis & payload checkout tetap sama persis SELAIN hal
// baru dari Siklus harga-seragam (2026-09-22): produk sekarang FIFO otomatis
// lintas batch (gak ada lagi dialog pilih batch) — harga jual default dari
// Product.sellPrice, tapi kasir bisa EDIT manual per baris pas checkout
// (CartLine.unitPrice langsung bisa diubah, dikirim sebagai
// unitPriceOverride). SERVER tetap yang resolve nama/harga final, harga di
// sini cuma pratinjau — kalau kasir gak ngedit apa-apa, harga yang kekirim
// ya harga default itu.
//
// Diskon SENGAJA cuma 1 (level-transaksi, di form ringkasan bawah) — bukan
// per-baris lagi. Backend (CheckoutItemDto.discount) masih nerima diskon
// per-item kalau dikirim, tapi UI ini sekarang gak pernah ngirim itu (selalu
// undefined) biar kasir gak bingung mikirin diskon di 2 tempat beda.

interface Product {
  id: string;
  name: string;
  brand: string | null;
  stock: number;
  sellPrice: string;
  // BARU (Point 2, 2026-09-23) — AC Indoor/Outdoor Berpasangan.
  pairedProductId: string | null;
  pairedProduct: { id: string; name: string } | null;
  // BARU (Paket AC Split, 2026-09-30) — peran unit AC, nentuin tab Indoor/
  // Outdoor. Null = belum ditentukan (produk lama), tampil di tab Semua.
  acRole: 'indoor' | 'outdoor' | null;
}
interface Sparepart {
  id: string;
  name: string;
  unit: string;
  sellPrice: string;
  stock: string;
  // Mode utuh/eceran (2026-09-30) — `unit`/`sellPrice` = satuan kecil
  // (eceran); utuh pakai packUnit/sellPricePack.
  trackingMode: SparepartMode;
  packUnit: string | null;
  packSize: string | null;
  sellPricePack: string | null;
}
interface ServiceItem {
  id: string;
  name: string;
  category: string | null;
  basePrice: string;
}

// Padanan InstallationPackage(+Item) — dipilih per BARIS produk yang
// "Pasang unit"-nya dicentang (lihat CartLine.packageId). Item-item paket
// (sparepart + biaya tambahan/unit) OTOMATIS jadi baris transaksi tersendiri
// & stok sparepart-nya ikut kepotong di server (lihat PosService.checkout,
// packageLines) — TIDAK perlu ditambahin manual ke keranjang.
interface InstallationPackageItem {
  qty: string;
  extraPricePerUnit: string;
}
interface InstallationPackageOption {
  id: string;
  name: string;
  items: InstallationPackageItem[];
}

// Hasil GET /members/search — sama endpoint yang tadinya cuma dipakai buat
// nawarin voucher (MembersController.search), sekarang dipakai juga buat
// fitur "pilih member yang udah ada" di POS (padanan fitur di app mobile:
// pelanggan yang balik lagi gak perlu didaftarin ulang jadi member baru).
interface MemberSearchResult {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

type CartItemKind = 'product' | 'sparepart' | 'service';

interface CartLine {
  kind: CartItemKind;
  refId: string;
  name: string;
  unit: string;
  // Harga jual baris ini — default dari Product.sellPrice (produk) /
  // Sparepart.sellPrice / Service.basePrice pas ditambahin, tapi buat
  // kind='product' BISA diedit manual di keranjang (lihat setUnitPrice) —
  // dikirim ke server sebagai `unitPriceOverride`.
  unitPrice: number;
  qty: number;
  // Diambil dari product.stock/sparepart.stock pas baris ditambah — cuma
  // buat cap tombol "+" di UI (soft guard), validasi beneran tetap di
  // server (StockLockingService).
  availableStock?: number;
  withInstallation: boolean;
  roomLocation: string;
  // Paket instalasi (opsional) buat baris ini — dipakai buat SEMUA unit di
  // baris ini kalau qty > 1 (1 baris = 1 pilihan paket, bukan per-unit).
  packageId?: string;
  // BARU (Point 2, 2026-09-23) — cuma keisi kalau baris ini bagian dari
  // pasangan "Unit Lengkap" yang ditambahin BARENGAN (lihat
  // addPairedProductLines). Dua baris (Indoor & Outdoor) yang sama
  // pairGroupKey-nya SELALU punya qty sama & dihapus BARENGAN — disinkronin
  // di setQty/removeAt/toggleInstallation.
  pairGroupKey?: string;
  pairRole?: 'indoor' | 'outdoor';
  // BARU (POS — Split/Indoor/Outdoor v2, 2026-09-30) — true kalau baris ini
  // butuh harga manual dari kasir (kasus "Indoor saja" dari produk
  // berpasangan — gak ada harga baku buat kombinasi ini, lihat
  // addIndoorOnlyLine). Dipakai buat indikator visual di baris keranjang
  // selama unitPrice masih 0, dan buat validasi blokir submit checkout
  // (lihat hasUnpricedLine).
  priceNeedsInput?: boolean;
  // BARU (Sparepart utuh/eceran, 2026-09-30) — cuma buat kind='sparepart'
  // mode konversi/gabungan. 'utuh': qty dalam packUnit (bulat), harga
  // sellPricePack. 'eceran': qty dalam satuan kecil, harga sellPrice.
  // Sparepart yang sama boleh 2 baris (utuh & eceran).
  saleKind?: 'utuh' | 'eceran';
}

interface CheckoutWarning {
  refId: string;
  itemCostId: string | null;
  name: string;
  buyPrice: number;
  sellPrice: number;
  discount: number;
  effectivePrice: number;
}

// Field lain di respons sukses (transactionId, serviceOrderId,
// installedUnits, dst) gak dibutuhin lagi di sini — abis sukses langsung
// router.push ke halaman detail invoice, dan halaman itu yang narik ulang
// semua data lewat GET /invoices/:id.
interface CheckoutOkResult {
  status: 'ok';
  invoiceId: string;
  invoiceNumber: string;
}
// BARU (Paket AC Split, 2026-09-30) — konfirmasi "jual 1 unit dari paket"
// (Indoor saja / Outdoor saja dari produk berpasangan). Modal restock dicatat
// per paket, jadi yang ditampilin = modal total 1 paket vs harga jual unit
// yang diisi kasir.
interface SingleUnitWarning {
  refId: string;
  name: string;
  unitRole: 'indoor' | 'outdoor';
  packageName: string;
  packageBuyPrice: number;
  sellPrice: number;
  qty: number;
}
interface CheckoutConfirmResult {
  status: 'confirm_required';
  warnings: CheckoutWarning[];
  singleUnitWarnings?: SingleUnitWarning[];
}
type CheckoutResult = CheckoutOkResult | CheckoutConfirmResult;

const checkoutSchema = z
  .object({
    name: z.string().min(1, 'Wajib diisi'),
    phone: z.string().min(1, 'Wajib diisi'),
    address: z.string().optional(),
    discount: optionalNumberField,
    discountReason: z.string().optional(),
    taxPercent: optionalNumberField,
    transportFee: optionalNumberField,
    notes: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    const discount = val.discount?.trim() ? Number(val.discount) : 0;
    if (discount > 0 && !val.discountReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountReason'],
        message: 'Alasan diskon wajib diisi kalau ada diskon',
      });
    }
    const tax = val.taxPercent?.trim() ? Number(val.taxPercent) : 0;
    if (tax < 0 || tax > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taxPercent'],
        message: 'Harus 0-100',
      });
    }
  });
type CheckoutFormValues = z.infer<typeof checkoutSchema>;

// GOTCHA browser — `crypto.randomUUID()` cuma jalan di "secure context"
// (HTTPS, atau `http://localhost`). Device kasir/gudang di sini biasanya
// dibuka lewat IP LAN (`http://192.168.x.x:3000`), yang dianggap browser
// TIDAK secure — `randomUUID` gak ada di situ (`crypto.randomUUID is not a
// function`), padahal `crypto.getRandomValues` TETAP jalan di context
// manapun (gak digating kayak randomUUID). Ini cuma dipakai buat kunci
// korelasi pasangan Indoor/Outdoor di keranjang (bukan buat keamanan), jadi
// gak perlu presisi RFC4122, asal cukup unik per baris.
function randomGroupKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback terakhir kalau `crypto` sama sekali gak ada (harusnya gak
  // kejadian di browser modern manapun).
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// Kunci unik per BARIS cart — selalu `${kind}:${refId}` (Siklus
// harga-seragam 2026-09-22: produk gak lagi punya konsep "batch" di
// keranjang, sama kayak lineKey() di PosService backend).
function lineMatchKey(l: { kind: CartItemKind; refId: string; saleKind?: 'utuh' | 'eceran' }): string {
  // Sama kayak lineKey() di PosService: sparepart jual UTUH punya key sendiri.
  if (l.kind === 'sparepart' && l.saleKind === 'utuh') return `${l.kind}:${l.refId}:utuh`;
  return `${l.kind}:${l.refId}`;
}

function mergeLine(lines: CartLine[], line: CartLine): CartLine[] {
  const idx = lines.findIndex((l) => lineMatchKey(l) === lineMatchKey(line));
  if (idx === -1) return [...lines, line];
  const merged = [...lines];
  const existing = merged[idx];
  const qty =
    existing.availableStock != null
      ? Math.min(existing.qty + line.qty, existing.availableStock)
      : existing.qty + line.qty;
  merged[idx] = { ...existing, qty };
  return merged;
}

// Pill kategori panel "Cari & Tambah Item" — merge Produk/Sparepart/Jasa jadi
// satu grid yang bisa difilter, padanan tab pill "Semua/AC Split/AC
// Cassette/dst" di prototype. SENGAJA tetap dikelompokkan berdasar 3 jenis
// data yang sudah ada (bukan bikin kolom kategori baru) — kategori granular
// ala prototype (AC Split/Cassette/Freon) belum ada datanya di backend, dan
// nambah itu di luar scope restyle tampilan ini.
// Paket AC Split (2026-09-30) — pill "Produk" dipecah jadi Split / Indoor
// / Outdoor (permintaan user: kasir langsung milih jenis unit yang dijual).
const CATEGORY_PILLS = [
  { key: 'all', label: 'Semua' },
  { key: 'split', label: 'Split' },
  { key: 'indoor', label: 'Indoor' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'sparepart', label: 'Sparepart' },
  { key: 'service', label: 'Jasa' },
] as const;
type CategoryKey = (typeof CATEGORY_PILLS)[number]['key'];

export default function PosPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [search, setSearch] = React.useState('');
  const [kindFilter, setKindFilter] = React.useState<CategoryKey>('all');
  // Diisi kalau checkout balik status confirm_required (ada baris produk
  // yang efektif dijual di bawah/pas modal). null = dialog konfirmasi tertutup.
  const [pendingWarnings, setPendingWarnings] = React.useState<CheckoutWarning[] | null>(null);
  const [pendingSingleUnits, setPendingSingleUnits] = React.useState<SingleUnitWarning[]>([]);

  // Pencarian member LAMA (opsional) — kalau kasir milih salah satu, nama/
  // HP/alamat di form otomatis keisi dan checkout nanti dikirim dengan
  // memberId eksplisit (bukan ngandelin pencocokan by-phone di backend).
  const [selectedMember, setSelectedMember] = React.useState<MemberSearchResult | null>(null);
  // Kode voucher (opsional) — ketik manual kasir, PERSIS kayak app mobile
  // (bukan dropdown pilihan voucher yang udah "diklaim" member). Voucher
  // tetap nempel ke satu member sejak dibuat admin, tapi validasi itu
  // (kode cocok member yang mana) sepenuhnya di server saat checkout —
  // field ini gak digating oleh ada/tidaknya member yang dipilih.
  const [voucherCode, setVoucherCode] = React.useState('');

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => apiClient.get<Product[]>('/products'),
  });
  const sparepartsQuery = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });
  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => apiClient.get<ServiceItem[]>('/services'),
  });

  // GET /installation-packages udah filter active:true di server — gak
  // perlu difilter lagi di sini.
  const packagesQuery = useQuery({
    queryKey: ['installation-packages'],
    queryFn: () => apiClient.get<InstallationPackageOption[]>('/installation-packages'),
  });

  // Audit 2026-09-30 — baris Split (ber-pairGroupKey) dan baris satuan dari
  // produk yang sama TIDAK boleh digabung: server nolak duplikat
  // `kind:refId`, dan merge diam-diam bikin Outdoor gratis / Indoor
  // kelebihan. Return false + toast kalau bentrok.
  function hasModeConflict(refIds: string[], mode: 'split' | 'single'): boolean {
    const clash = lines.find(
      (l) => l.kind === 'product' && refIds.includes(l.refId) && (l.pairGroupKey ? 'split' : 'single') !== mode,
    );
    if (!clash) return false;
    toast.error(
      `${clash.name} sudah ada di keranjang sebagai ${mode === 'split' ? 'unit satuan' : 'bagian Split'}. Hapus dulu baris itu, atau selesaikan transaksinya, baru tambah yang ini.`,
    );
    return true;
  }

  function addLine(line: CartLine) {
    if (line.kind === 'product' && hasModeConflict([line.refId], line.pairGroupKey ? 'split' : 'single')) return;
    setLines((prev) => mergeLine(prev, line));
    toast.success(`${line.name} ditambahkan ke keranjang.`);
  }

  function addProductLine(p: Product) {
    addLine({
      kind: 'product',
      refId: p.id,
      name: p.name,
      unit: 'unit',
      unitPrice: Number(p.sellPrice),
      qty: 1,
      availableStock: p.stock,
      withInstallation: false,
      roomLocation: '',
      packageId: undefined,
      // Unit ber-peran tanpa harga jual (mis. Outdoor yang Indoor-nya
      // nonaktif) = harga wajib diisi kasir, jangan lolos Rp0.
      priceNeedsInput: p.acRole != null && Number(p.sellPrice) <= 0 ? true : undefined,
    });
  }

  // BARU (Point 2, 2026-09-23) — toggle "Sekalian Outdoor-nya" di kartu POS.
  // `addLine` (BUKAN `addProductLine`) dipakai langsung di sini biar TIDAK
  // lewat mergeLine-by-refId — 2 pasangan yang beda kudu selalu jadi 2 baris
  // baru, gak boleh nge-merge ke baris lama yang kebetulan refId sama tapi
  // beda pasangan (kasus langka tapi mending eksplisit).
  function addPairedProductLines(indoorProduct: Product) {
    if (!indoorProduct.pairedProduct) return;
    if (hasModeConflict([indoorProduct.id, indoorProduct.pairedProduct.id], 'split')) return;
    // Stok Split dibatasi sisi yang paling sedikit — qty Indoor & Outdoor
    // SELALU sama, jadi dua-duanya di-cap ke min(stok Indoor, stok Outdoor).
    const outdoorStock = productsById.get(indoorProduct.pairedProduct.id)?.stock ?? 0;
    const splitCap = Math.max(0, Math.min(indoorProduct.stock, outdoorStock));
    const groupKey = randomGroupKey();
    addLine({
      kind: 'product',
      refId: indoorProduct.id,
      name: indoorProduct.name,
      unit: 'unit',
      unitPrice: Number(indoorProduct.sellPrice),
      qty: 1,
      withInstallation: false,
      roomLocation: '',
      availableStock: splitCap,
      pairGroupKey: groupKey,
      pairRole: 'indoor',
    });
    addLine({
      kind: 'product',
      refId: indoorProduct.pairedProduct.id,
      name: indoorProduct.pairedProduct.name,
      unit: 'unit',
      unitPrice: 0,
      qty: 1,
      withInstallation: false,
      roomLocation: '',
      availableStock: splitCap,
      pairGroupKey: groupKey,
      pairRole: 'outdoor',
    });
  }

  // Jual Outdoor SENDIRIAN (bukan bagian dari Split), mis. ganti unit
  // outdoor yang rusak/garansi. Paket AC Split (2026-09-30): kalau Outdoor
  // ini bagian dari paket, harganya GAK baku (sama kayak Indoor saja) —
  // mulai Rp0 & wajib diisi kasir (`priceNeedsInput`). Produk "Outdoor
  // saja" yang GAK berpasangan lewat `addProductLine` biasa (harga jualnya
  // sendiri), bukan lewat sini.
  function addOutdoorOnlyLine(outdoorProduct: Product) {
    addLine({
      kind: 'product',
      refId: outdoorProduct.id,
      name: outdoorProduct.name,
      unit: 'unit',
      unitPrice: 0,
      qty: 1,
      availableStock: outdoorProduct.stock,
      withInstallation: false,
      roomLocation: '',
      packageId: undefined,
      priceNeedsInput: true,
    });
  }

  // BARU (POS — Split/Indoor/Outdoor v2, 2026-09-30) — jual Indoor
  // SENDIRIAN dari produk yang PUNYA pasangan (misal servis ganti komponen
  // indoor doang). Beda dari `addProductLine`: `p.sellPrice` di sini adalah
  // harga PAKET (Split), bukan harga Indoor-doang — gak ada harga baku buat
  // kombinasi ini (keputusan user: kondisional/nego di lapangan per
  // transaksi), jadi mulai dari Rp0 & ditandai `priceNeedsInput` biar
  // keranjang kasih indikator visual dan submit checkout keblokir sampai
  // kasir isi manual. `addProductLine` yang lama TETAP dipakai apa adanya
  // buat produk standalone tanpa pasangan (itu emang benar pakai sellPrice).
  function addIndoorOnlyLine(indoorProduct: Product) {
    addLine({
      kind: 'product',
      refId: indoorProduct.id,
      name: indoorProduct.name,
      unit: 'unit',
      unitPrice: 0,
      qty: 1,
      availableStock: indoorProduct.stock,
      withInstallation: false,
      roomLocation: '',
      packageId: undefined,
      priceNeedsInput: true,
    });
  }

  // Ubah harga jual baris produk secara manual (kasir bisa nego harga di
  // kasir) — dikirim ke server sebagai unitPriceOverride pas checkout.
  function setUnitPrice(index: number, value: number) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, unitPrice: value } : l)));
  }

  function setQty(index: number, qty: number) {
    if (qty <= 0) return;
    setLines((prev) => {
      const target = prev[index];
      if (!target) return prev;
      // Point 2 (2026-09-23) — baris ber-pairGroupKey (Indoor+Outdoor mode
      // Unit Lengkap) SELALU punya qty sama, jadi perubahan di baris manapun
      // dari pasangan itu diterapkan ke SEMUA baris pasangannya juga.
      return prev.map((l) => {
        if (l !== target && !(target.pairGroupKey && l.pairGroupKey === target.pairGroupKey)) {
          return l;
        }
        const capped = l.availableStock != null ? Math.min(qty, l.availableStock) : qty;
        return { ...l, qty: capped };
      });
    });
  }

  // Qty sparepart boleh pecahan (eceran m/kg/liter, maks 2 desimal) — utuh
  // tetap bulat. Di-cap ke availableStock kalau ada (soft guard).
  function setQtyExact(index: number, qty: number) {
    if (!(qty > 0)) return;
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const rounded = l.saleKind === 'utuh' ? Math.trunc(qty) : Math.round(qty * 100) / 100;
        if (!(rounded > 0)) return l;
        return { ...l, qty: l.availableStock != null ? Math.min(rounded, l.availableStock) : rounded };
      }),
    );
  }

  function removeAt(index: number) {
    setLines((prev) => {
      const target = prev[index];
      if (!target) return prev;
      // Point 2 (2026-09-23) — hapus 1 baris pasangan Unit Lengkap harus
      // ikut ngehapus baris pasangannya juga (gak boleh nyisain Outdoor
      // doang atau Indoor doang di keranjang).
      return prev.filter(
        (l) => l !== target && !(target.pairGroupKey && l.pairGroupKey === target.pairGroupKey),
      );
    });
  }

  function toggleInstallation(index: number, value: boolean) {
    setLines((prev) => {
      const target = prev[index];
      if (!target) return prev;
      return prev.map((l) =>
        l === target || (target.pairGroupKey && l.pairGroupKey === target.pairGroupKey)
          ? { ...l, withInstallation: value }
          : l,
      );
    });
  }

  function setLinePackage(index: number, packageId: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, packageId: packageId === 'none' ? undefined : packageId } : l)),
    );
  }

  // Total extraPricePerUnit item-item paket instalasi buat 1 UNIT (belum
  // dikali qty baris) — dipakai buat pratinjau biaya & label harga di
  // dropdown pemilihan paket.
  function packageCostPerUnit(pkg: InstallationPackageOption): number {
    return pkg.items.reduce(
      (sum, it) => sum + Math.round(Number(it.qty) * Number(it.extraPricePerUnit)),
      0,
    );
  }

  function setRoomLocation(index: number, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, roomLocation: value } : l)));
  }

  // Biaya tambahan paket instalasi — server nambahin item2 paket sebagai
  // baris transaksi TERSENDIRI (packageLines, 1 SET PENUH item paket per
  // UNIT yang dipasang, lihat PosService.checkout), jadi ikut nambah
  // subtotal/grandTotal beneran walau gak ada di `lines` (keranjang).
  const packageExtraTotal = lines.reduce((sum, l) => {
    if (!l.withInstallation || !l.packageId) return sum;
    const pkg = packagesQuery.data?.find((p) => p.id === l.packageId);
    if (!pkg) return sum;
    return sum + packageCostPerUnit(pkg) * l.qty;
  }, 0);

  // Subtotal preview — samain sama computeTotals() backend: qty*unitPrice
  // tiap baris DITAMBAH biaya paket instalasi di atas. Diskon (satu-satunya,
  // level-transaksi) baru dipotong belakangan lewat `discountPreview` di
  // bawah — lihat taxBase/grandTotal.
  const subtotal =
    lines.reduce((sum, l) => sum + Math.round(l.qty * l.unitPrice), 0) + packageExtraTotal;

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      name: '',
      phone: '',
      address: '',
      discount: '',
      discountReason: '',
      taxPercent: '',
      transportFee: '',
      notes: '',
    },
  });

  function selectMember(m: MemberSearchResult) {
    setSelectedMember(m);
    form.setValue('name', m.name, { shouldValidate: true });
    form.setValue('phone', m.phone ?? '', { shouldValidate: true });
    form.setValue('address', m.address ?? '');
  }

  function clearSelectedMember() {
    setSelectedMember(null);
    // Data yang otomatis ke-isi pas milih member (nama/HP/alamat) ikut
    // dikosongin lagi — biar "Ganti" beneran balik ke keadaan kosong buat
    // pelanggan baru, bukan nyisain data member sebelumnya nempel di form.
    form.setValue('name', '');
    form.setValue('phone', '');
    form.setValue('address', '');
    // Voucher nempel ke member — ganti/lepas member berarti kode yang udah
    // diketik kemungkinan besar gak relevan lagi buat pelanggan yang baru.
    setVoucherCode('');
  }

  // Number(...) bisa NaN kalau user lagi setengah ngetik (mis. "-" doang) —
  // fallback ke 0 biar ringkasan total di bawah gak sempat nampilin "Rp NaN".
  const safeNumber = (v: string | undefined) => {
    const n = Number(v ?? '');
    return Number.isFinite(n) ? n : 0;
  };
  const discountPreview = safeNumber(form.watch('discount'));
  const taxPercentPreview = safeNumber(form.watch('taxPercent'));
  const transportFeePreview = safeNumber(form.watch('transportFee'));

  // Potongan voucher TIDAK diestimasi di sini — beda dari dulu (campaign
  // punya rule yang predictable di client), sekarang validasi kode +
  // hitungan potongannya sepenuhnya di server saat checkout (lihat
  // VouchersService.lockAndValidateCode), persis kayak app mobile yang juga
  // gak preview apa-apa sebelum submit.
  const taxBase = Math.max(0, subtotal - discountPreview);
  const taxAmount = Math.round((taxBase * taxPercentPreview) / 100);
  const grandTotal = taxBase + taxAmount + transportFeePreview;
  const discountExceeds = discountPreview > subtotal;
  // BARU (v2, 2026-09-30) — baris "Indoor saja" yang harganya belum diisi
  // kasir gak boleh lolos checkout (defaultnya Rp0, itu bukan harga jual
  // beneran, lihat addIndoorOnlyLine).
  const hasUnpricedLine = lines.some((l) => l.priceNeedsInput && l.unitPrice <= 0);

  const checkoutMutation = useMutation({
    mutationFn: async (values: CheckoutFormValues & { confirmOverride?: boolean }) => {
      const discount = values.discount?.trim() ? Number(values.discount) : 0;
      const taxPercent = values.taxPercent?.trim() ? Number(values.taxPercent) : 0;
      const transportFee = values.transportFee?.trim() ? Number(values.transportFee) : 0;

      // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) —
      // itemIndex tunggal jadi itemIndexes[]. Baris Outdoor (pairRole
      // 'outdoor') TIDAK bikin entri instalasi sendiri — dia numpang di
      // entri instalasi baris Indoor pasangannya (index ke-0 = Indoor,
      // index ke-1 = Outdoor, konvensi urutan yang sama dipakai backend).
      const installations: { itemIndexes: number[]; roomLocation?: string; packageId?: string }[] =
        [];
      lines.forEach((line, index) => {
        if (line.kind !== 'product' || !line.withInstallation) return;
        if (line.pairRole === 'outdoor') return; // numpang di entri Indoor-nya
        const pairedIndex =
          line.pairGroupKey != null
            ? lines.findIndex((l) => l.pairGroupKey === line.pairGroupKey && l.pairRole === 'outdoor')
            : -1;
        const itemIndexes = pairedIndex >= 0 ? [index, pairedIndex] : [index];
        // Satu entri instalasi PER UNIT (qty produk selalu bilangan bulat,
        // sama seperti aturan CheckoutItemDto backend) — sama seperti
        // buildCheckoutPayload di Flutter (satu unit AC = satu job teknisi).
        // Paket instalasi yang dipilih di baris ini (kalau ada) dipasang ke
        // SEMUA unit di baris ini — server bikin 1 set item paket per unit.
        for (let j = 0; j < line.qty; j++) {
          installations.push({
            itemIndexes,
            roomLocation: trimmedOrUndefined(line.roomLocation),
            packageId: line.packageId,
          });
        }
      });

      return apiClient.post<CheckoutResult>('/pos/checkout', {
        customer: {
          name: values.name.trim(),
          phone: values.phone.trim(),
          address: trimmedOrUndefined(values.address),
          // Kalau kasir milih member lama dari pencarian, kirim id-nya
          // eksplisit — backend langsung pakai member itu, skip pencocokan
          // by-phone (lihat CheckoutCustomerDto.memberId).
          memberId: selectedMember?.id,
        },
        items: lines.map((l) => ({
          kind: l.kind,
          refId: l.refId,
          qty: l.qty,
          // Diskon per-item SENGAJA gak pernah dikirim dari sini lagi —
          // cuma ada 1 diskon (level-transaksi, `discount` di bawah).
          //
          // unitPriceOverride SELALU dikirim buat baris produk — line.unitPrice
          // udah langsung jadi "harga efektif" begitu ditambah ke keranjang
          // (default Product.sellPrice, bisa diedit manual lewat setUnitPrice).
          // Kalau kasir gak pernah nyentuh, nilainya ya sama persis kayak
          // default itu — server tetap terima sebagai override eksplisit,
          // gak masalah (hasilnya identik).
          unitPriceOverride: l.kind === 'product' ? l.unitPrice : undefined,
          saleKind: l.kind === 'sparepart' ? l.saleKind : undefined,
          // BARU (Point 2, 2026-09-23) — baris Outdoor mode Unit Lengkap
          // nunjuk index baris Indoor pasangannya, biar server maksa
          // harganya 0 & nyamain pairGroupId di StockMovement dua-duanya.
          pairedWithItemIndex:
            l.pairRole === 'outdoor'
              ? lines.findIndex((other) => other.pairGroupKey === l.pairGroupKey && other.pairRole === 'indoor')
              : undefined,
        })),
        discount,
        discountReason: discount > 0 ? values.discountReason?.trim() : undefined,
        taxPercent,
        transportFee,
        notes: trimmedOrUndefined(values.notes),
        installations: installations.length ? installations : undefined,
        voucherCode: trimmedOrUndefined(voucherCode)?.toUpperCase(),
        confirmOverride: values.confirmOverride,
      });
    },
    onSuccess: (result) => {
      if (result.status === 'confirm_required') {
        // HTTP 200, bukan error — belum ada transaksi kesimpen (rollback
        // otomatis di server), nunggu kasir/admin confirm dulu lewat dialog.
        // Keranjang & form SENGAJA gak direset biar gampang confirm ulang.
        setPendingWarnings(result.warnings);
        setPendingSingleUnits(result.singleUnitWarnings ?? []);
        return;
      }
      // Unit AC baru DIJATAH di checkout; stok resmi berkurang setelah gudang
      // menscan QR unitnya (halaman Keluar Gudang). Kasir perlu tahu ini.
      const hasUnit = lines.some((l) => l.kind === 'product');
      toast.success(`Transaksi dibuat: ${result.invoiceNumber}`, {
        description: hasUnit ? 'Unit AC belum keluar gudang. Gudang akan menyiapkan dan scan QR unitnya.' : undefined,
        duration: hasUnit ? 8000 : undefined,
      });
      setLines([]);
      form.reset();
      setSelectedMember(null);
      setVoucherCode('');
      setPendingWarnings(null);
      // Stok produk/sparepart yg baru kepotong -> data master jadi basi,
      // sekalian invalidate biar Master Data konsisten kalau dibuka lagi.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
      // Voucher yang baru kepake statusnya berubah jadi 'terpakai' -> hilang
      // dari daftar aktif kalau halaman Voucher lagi kebuka.
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      // Auto-redirect ke halaman detail invoice — padanan context.go ke
      // /transactions/:id di app mobile abis checkout sukses. Halaman
      // detail itu yang jadi tempat "Catat Pembayaran" (invoice lahir
      // dengan totalPaid: 0, lihat pos.service.ts) sekaligus nyimpen semua
      // pilihan cetak (Invoice/Surat Jalan/Label Unit) lewat PrintMenu.
      // (2026-09: sempat dicoba auto-bayar langsung LUNAS pas checkout,
      // tapi konsepnya dibalikin lagi ke alur lama ini atas permintaan —
      // yang dipertahankan cuma gaya visualnya, bukan alur bisnisnya.)
      router.push(`/invoices/${result.invoiceId}`);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal membuat transaksi.');
    },
  });

  function onSubmit(values: CheckoutFormValues) {
    if (lines.length === 0) {
      toast.error('Keranjang masih kosong.');
      return;
    }
    if (discountExceeds) {
      toast.error('Diskon melebihi subtotal.');
      return;
    }
    if (hasUnpricedLine) {
      toast.error('Ada unit satuan (Indoor/Outdoor saja) yang harganya belum diisi.');
      return;
    }
    checkoutMutation.mutate(values);
  }

  function confirmCheckout() {
    checkoutMutation.mutate({ ...form.getValues(), confirmOverride: true });
  }

  const q = search.trim().toLowerCase();
  const filteredProducts = (productsQuery.data ?? []).filter((p) =>
    p.name.toLowerCase().includes(q),
  );
  const filteredSpareparts = (sparepartsQuery.data ?? []).filter((s) =>
    s.name.toLowerCase().includes(q),
  );
  const filteredServices = (servicesQuery.data ?? []).filter((s) =>
    s.name.toLowerCase().includes(q),
  );

  // Paket AC Split (2026-09-30) — 1 Produk AC = paket Indoor + Outdoor
  // (2 Product yang dipasangkan lewat `pairedProductId` di sisi Indoor).
  // Grid dipecah per JENIS: tab Split (1 kartu per paket, sekali klik = 1
  // Indoor + 1 Outdoor), tab Indoor & Outdoor (kartu per unit — unit dari
  // paket = harga diisi manual kasir, produk "Indoor/Outdoor saja" yang
  // gak berpasangan = harga jualnya sendiri). Lihat spec
  // specs/2026-09-30-paket-ac-split-design.md (gantiin kartu 3 tombol v2).
  const allProducts = productsQuery.data ?? [];
  const productsById = new Map(allProducts.map((p) => [p.id, p] as const));
  // Outdoor sebuah paket -> Indoor yang masangin dia.
  const indoorByOutdoorId = new Map(
    allProducts.filter((p) => p.pairedProductId).map((p) => [p.pairedProductId!, p] as const),
  );
  const matchesSearch = (name: string) => name.toLowerCase().includes(q);

  type Card = {
    key: string;
    name: string;
    subtitle?: string;
    price?: string;
    priceLabel?: string;
    badge?: { label: string; tone: 'ok' | 'warn' };
    disabled: boolean;
    onAdd: () => void;
  };

  // Tab Split — 1 kartu per paket. Harga = harga paket (Product.sellPrice
  // sisi Indoor, Outdoor Rp0 di keranjang). Salah satu unit habis = kartu
  // gak bisa diklik + peringatan unit mana yang habis.
  const splitCards: Card[] = allProducts
    .filter((p) => p.pairedProductId)
    .flatMap((p) => {
      const outdoor = productsById.get(p.pairedProductId!);
      const outdoorName = outdoor?.name ?? p.pairedProduct?.name ?? 'Outdoor';
      if (!matchesSearch(p.name) && !matchesSearch(outdoorName)) return [];
      const indoorStock = p.stock;
      const outdoorStock = outdoor?.stock ?? 0;
      const habis = [indoorStock <= 0 && 'Indoor', outdoorStock <= 0 && 'Outdoor'].filter(Boolean);
      return [
        {
          key: `split-${p.id}`,
          name: `${p.name} + ${outdoorName}`,
          subtitle: `Indoor ${indoorStock} • Outdoor ${outdoorStock} → paket siap: ${Math.max(0, Math.min(indoorStock, outdoorStock))}${p.brand ? ` • ${p.brand}` : ''}`,
          price: p.sellPrice,
          badge: !outdoor
            ? { label: '⚠ Outdoor nonaktif', tone: 'warn' as const }
            : habis.length > 0
              ? { label: `⚠ ${habis.join(' & ')} habis`, tone: 'warn' as const }
              : { label: 'Lengkap', tone: 'ok' as const },
          disabled: !outdoor || habis.length > 0,
          onAdd: () => addPairedProductLines(p),
        },
      ];
    });

  // Kartu 1 unit (tab Indoor/Outdoor, dan produk tanpa peran di tab Semua).
  // `pairName` keisi = unit dari paket (nama unit pasangannya) -> harga
  // diisi manual kasir.
  function unitCard(p: Product, pairName: string | null, onAddPackageUnit: () => void): Card {
    const outOfStock = p.stock <= 0;
    if (pairName) {
      return {
        key: `unit-${p.id}`,
        name: p.name,
        subtitle: `${outOfStock ? 'Stok habis' : `Stok ${p.stock}`} • pasangan: ${pairName}`,
        priceLabel: 'Harga diisi manual',
        disabled: outOfStock,
        onAdd: onAddPackageUnit,
      };
    }
    return {
      key: `unit-${p.id}`,
      name: p.name,
      subtitle: outOfStock
        ? 'Belum ada stok — input dulu lewat Barang Masuk'
        : `Stok ${p.stock}${p.brand ? ` • ${p.brand}` : ''}`,
      price: outOfStock ? undefined : p.sellPrice,
      disabled: outOfStock,
      onAdd: () => addProductLine(p),
    };
  }

  const indoorCards: Card[] = filteredProducts
    .filter((p) => p.acRole === 'indoor' || (p.pairedProductId && !p.acRole))
    .map((p) =>
      unitCard(p, p.pairedProductId ? (p.pairedProduct?.name ?? 'Outdoor') : null, () => addIndoorOnlyLine(p)),
    );
  const outdoorCards: Card[] = filteredProducts
    .filter((p) => p.acRole === 'outdoor' || (indoorByOutdoorId.has(p.id) && !p.acRole))
    .map((p) => {
      const indoor = indoorByOutdoorId.get(p.id);
      return unitCard(p, indoor ? indoor.name : null, () => addOutdoorOnlyLine(p));
    });
  // Produk yang belum punya peran & gak berpasangan (mis. produk lama) —
  // tetap bisa dijual kayak biasa lewat tab Semua.
  const otherProductCards: Card[] = filteredProducts
    .filter((p) => !p.acRole && !p.pairedProductId && !indoorByOutdoorId.has(p.id))
    .map((p) => unitCard(p, null, () => addProductLine(p)));
  // Unit "Indoor saja"/"Outdoor saja" yang GAK berpasangan ikut tampil di
  // tab Semua (unit dari paket cuma lewat tab Indoor/Outdoor, biar tab Semua
  // gak dobel sama kartu Split-nya).
  const standaloneRoleCards: Card[] = filteredProducts
    .filter((p) => p.acRole && !p.pairedProductId && !indoorByOutdoorId.has(p.id))
    .map((p) => unitCard(p, null, () => addProductLine(p)));

  // Sparepart mode utuh/eceran (2026-09-30) -> 2 kartu (Utuh & Eceran) biar
  // kasir langsung milih cara jualnya; mode lain tetap 1 kartu.
  const sparepartCards: Card[] = filteredSpareparts.flatMap((s): Card[] => {
    const packSize = s.packSize ? Number(s.packSize) : 0;
    const base = {
      kind: 'sparepart' as const,
      refId: s.id,
      withInstallation: false,
      roomLocation: '',
    };
    if (!hasPackSale(s.trackingMode) || !s.packUnit || !(packSize > 0) || !s.sellPricePack) {
      return [
        {
          key: `sparepart-${s.id}`,
          name: s.name,
          subtitle: `Stok ${s.stock} ${s.unit}`,
          price: s.sellPrice,
          disabled: false,
          onAdd: () =>
            addLine({ ...base, name: s.name, unit: s.unit, unitPrice: Number(s.sellPrice), qty: 1 }),
        },
      ];
    }
    const stockLabel = formatStock(s);
    return [
      {
        key: `sparepart-${s.id}-utuh`,
        name: `${s.name} — Utuh`,
        subtitle: `per ${s.packUnit} (isi ${s.packSize} ${s.unit}) • Stok ${stockLabel}`,
        price: s.sellPricePack,
        disabled: Number(s.stock) < packSize,
        onAdd: () =>
          addLine({
            ...base,
            name: s.name,
            unit: s.packUnit!,
            unitPrice: Number(s.sellPricePack),
            qty: 1,
            saleKind: 'utuh',
            availableStock: Math.floor(Number(s.stock) / packSize),
          }),
      },
      {
        key: `sparepart-${s.id}-eceran`,
        name: `${s.name} — Eceran`,
        subtitle: `per ${s.unit} • Stok ${stockLabel}`,
        price: s.sellPrice,
        disabled: Number(s.stock) <= 0,
        onAdd: () =>
          addLine({
            ...base,
            name: s.name,
            unit: s.unit,
            unitPrice: Number(s.sellPrice),
            qty: 1,
            saleKind: 'eceran',
          }),
      },
    ];
  });
  const serviceCards: Card[] = filteredServices.map((s) => ({
    key: `service-${s.id}`,
    name: s.name,
    subtitle: s.category ?? 'Jasa',
    price: s.basePrice,
    disabled: false,
    onAdd: () =>
      addLine({
        kind: 'service' as const,
        refId: s.id,
        name: s.name,
        unit: 'jasa',
        unitPrice: Number(s.basePrice),
        qty: 1,
        withInstallation: false,
        roomLocation: '',
      }),
  }));

  const visibleCards: Card[] =
    kindFilter === 'all'
      ? [...splitCards, ...standaloneRoleCards, ...otherProductCards, ...sparepartCards, ...serviceCards]
      : kindFilter === 'split'
        ? splitCards
        : kindFilter === 'indoor'
          ? indoorCards
          : kindFilter === 'outdoor'
            ? outdoorCards
            : kindFilter === 'sparepart'
              ? sparepartCards
              : serviceCards;
  const isProductTab = kindFilter === 'split' || kindFilter === 'indoor' || kindFilter === 'outdoor';
  const cardsLoading =
    (kindFilter === 'all' || isProductTab) && productsQuery.isLoading
      ? true
      : (kindFilter === 'all' || kindFilter === 'sparepart') && sparepartsQuery.isLoading
        ? true
        : (kindFilter === 'all' || kindFilter === 'service') && servicesQuery.isLoading;


  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Kasir (POS)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tambah item ke keranjang, isi data pelanggan, lalu buat transaksi.
        </p>
      </div>

      {/* items-start — kolom kanan (keranjang + checkout) sekarang bisa lebih
          tinggi dari kolom kiri (cari item), jadi grid default (stretch)
          bakal maksa kolom kiri ikut setinggi itu (nyisain ruang kosong
          aneh di bawah card pencarian). items-start bikin tiap kolom
          setinggi konten masing-masing. */}
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cari & Tambah Item</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative mb-3">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari nama item..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {CATEGORY_PILLS.map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setKindFilter(pill.key)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    kindFilter === pill.key
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'hover:bg-accent',
                  )}
                >
                  {pill.label}
                </button>
              ))}
            </div>
            {cardsLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>
            ) : visibleCards.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Tidak ada item yang cocok.
              </p>
            ) : (
              <div className="grid max-h-[28rem] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                {visibleCards.map((card) => (
                  <ItemCard
                    key={card.key}
                    name={card.name}
                    subtitle={card.subtitle}
                    price={card.price}
                    priceLabel={card.priceLabel}
                    badge={card.badge}
                    disabled={card.disabled}
                    onAdd={card.onAdd}
                  />
                ))}
              </div>
            )}
            </CardContent>
        </Card>

        {/* Keranjang ditaruh DI ATAS form checkout (bukan di bawah panel
            pencarian kayak sebelumnya) — biar abis nambah item dari panel
            kiri, perubahan keranjangnya langsung keliatan di sidebar kanan
            tanpa perlu scroll ngelewatin daftar produk yang panjang. */}
        <div className="grid gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Keranjang</CardTitle>
              {lines.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setLines([])}>
                  Kosongkan
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {lines.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                  <ShoppingCart className="size-8" />
                  <p className="text-sm">Keranjang masih kosong.</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {lines.map((line, index) => (
                    <div key={lineMatchKey(line)} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {line.name}
                            {line.pairGroupKey && (
                              <span className="ml-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-normal text-secondary-foreground align-middle">
                                Pasangan Unit Lengkap
                              </span>
                            )}
                            {line.priceNeedsInput && (
                              <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-normal text-amber-800 align-middle">
                                Unit satuan dari paket
                              </span>
                            )}
                            {line.kind === 'sparepart' && line.saleKind && (
                              <span className="ml-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-normal text-secondary-foreground align-middle">
                                {line.saleKind === 'utuh' ? 'Utuh' : 'Eceran'}
                              </span>
                            )}
                          </p>
                          {line.kind === 'product' && line.pairRole === 'outdoor' ? (
                            // Point 2 (2026-09-23) — harga Outdoor mode Unit
                            // Lengkap DIKUNCI 0 (nempel ke harga Indoor
                            // pasangannya), gak bisa diedit manual di sini.
                            <p className="mt-1 text-xs text-muted-foreground">
                              Rp 0 (gratis, nempel ke Indoor) / {line.unit}
                            </p>
                          ) : line.kind === 'product' ? (
                            <div>
                              <div className="mt-1 flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Harga:</span>
                                <CurrencyInput
                                  className={cn(
                                    'h-7 w-28 text-xs',
                                    line.priceNeedsInput &&
                                      line.unitPrice <= 0 &&
                                      'border-amber-500 focus-visible:ring-amber-500',
                                  )}
                                  value={String(line.unitPrice)}
                                  onChange={(v) => setUnitPrice(index, Number(v) || 0)}
                                />
                                <span className="text-xs text-muted-foreground">
                                  / {line.unit}
                                </span>
                              </div>
                              {/* Unit satuan dari paket (Indoor/Outdoor saja) */}
                              {line.priceNeedsInput && line.unitPrice <= 0 && (
                                <p className="mt-0.5 text-[10px] text-amber-600">
                                  Wajib diisi manual sebelum checkout.
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {formatRupiah(line.unitPrice)} / {line.unit}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeAt(index)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1 rounded-full bg-muted px-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={line.qty <= 1}
                            onClick={() => setQty(index, line.qty - 1)}
                          >
                            <Minus className="size-3.5" />
                          </Button>
                          {line.kind === 'sparepart' && line.saleKind ? (
                            <QtyInput
                              value={line.qty}
                              integer={line.saleKind === 'utuh'}
                              onCommit={(v) => setQtyExact(index, v)}
                            />
                          ) : (
                            <span className="w-6 text-center text-sm font-medium">{line.qty}</span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={
                              line.availableStock != null && line.qty >= line.availableStock
                            }
                            onClick={() => setQty(index, line.qty + 1)}
                          >
                            <Plus className="size-3.5" />
                          </Button>
                        </div>
                        <p className="text-sm font-semibold">
                          {formatRupiah(Math.round(line.qty * line.unitPrice))}
                        </p>
                      </div>
                      {line.kind === 'product' && (
                        <div className="mt-3 border-t pt-3">
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={line.withInstallation}
                              onCheckedChange={(v) => toggleInstallation(index, v === true)}
                            />
                            Pasang unit (buat job teknisi otomatis)
                          </label>
                          {line.withInstallation && (
                            <div className="mt-2 grid gap-2">
                              <Input
                                placeholder="Lokasi ruangan (opsional), mis. Kamar Utama"
                                value={line.roomLocation}
                                onChange={(e) => setRoomLocation(index, e.target.value)}
                              />
                              <Select
                                value={line.packageId ?? 'none'}
                                onValueChange={(v) => setLinePackage(index, v)}
                              >
                                <SelectTrigger className="w-full">
                                  <Package className="size-4 text-muted-foreground" />
                                  <SelectValue placeholder="Paket instalasi (opsional)" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Tanpa paket instalasi</SelectItem>
                                  {packagesQuery.data?.map((pkg) => (
                                    <SelectItem key={pkg.id} value={pkg.id}>
                                      {pkg.name} (+{formatRupiah(packageCostPerUnit(pkg))}/unit)
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
          <CardHeader>
            <CardTitle className="text-base">Data Pelanggan & Checkout</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
                {/* Pilih member LAMA (opsional) — padanan fitur "tambah
                    member" yang ada di app mobile: pelanggan yang balik
                    lagi tinggal dicari & dipilih di sini, gak perlu
                    diketik ulang dan gak bikin akun member baru/ganda. */}
                <MemberPicker value={selectedMember} onSelect={selectMember} onClear={clearSelectedMember} />

                {/* Kode voucher — diketik manual kasir, sama kayak app mobile.
                    Voucher dibuat admin untuk satu pelanggan tertentu (lihat
                    halaman Voucher); server yang validasi kodenya cocok buat
                    pelanggan transaksi ini atau bukan saat checkout. */}
                <div className="grid gap-1.5">
                  <FormLabel className="flex items-center gap-1.5">
                    <Ticket className="size-4" />
                    Kode Voucher (opsional)
                  </FormLabel>
                  <Input
                    placeholder="Contoh: VCR-AB12CD"
                    value={voucherCode}
                    onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                    className="uppercase"
                  />
                </div>

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nama Pelanggan</FormLabel>
                      <FormControl>
                        <Input placeholder="Nama di struk" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nomor HP</FormLabel>
                      <FormControl>
                        <Input placeholder="08xxxxxxxxxx" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Alamat</FormLabel>
                      <FormControl>
                        <Textarea rows={2} placeholder="Opsional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  {selectedMember
                    ? 'Transaksi ini disimpan atas nama member yang dipilih di atas.'
                    : 'Belum pilih member — kalau nomor HP di bawah ini cocok sama member yang sudah ada, otomatis disambungkan ke situ; kalau belum ada, member baru langsung dibuatkan saat transaksi disimpan.'}
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="discount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Diskon (Rp)</FormLabel>
                        <FormControl>
                          <CurrencyInput {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="taxPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pajak (%)</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="discountReason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Alasan Diskon</FormLabel>
                      <FormControl>
                        <Input placeholder="Wajib kalau ada diskon" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="transportFee"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ongkos Transport (Rp)</FormLabel>
                      <FormControl>
                        <CurrencyInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notes"
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

                <div className="rounded-md border p-3 text-sm">
                  <SummaryRow label="Subtotal" value={formatRupiah(subtotal)} />
                  {packageExtraTotal > 0 && (
                    <p className="py-0.5 text-xs text-muted-foreground">
                      (termasuk paket instalasi: {formatRupiah(packageExtraTotal)})
                    </p>
                  )}
                  <SummaryRow label="Diskon" value={`- ${formatRupiah(discountPreview)}`} />
                  {voucherCode.trim() && (
                    <SummaryRow label={`Voucher (${voucherCode.trim()})`} value="Dihitung saat diproses" />
                  )}
                  <SummaryRow label="Pajak" value={formatRupiah(taxAmount)} />
                  <SummaryRow label="Transport" value={formatRupiah(transportFeePreview)} />
                  {discountExceeds && (
                    <p className="mt-1 text-xs text-destructive">Diskon melebihi subtotal.</p>
                  )}
                  {hasUnpricedLine && (
                    <p className="mt-1 text-xs text-destructive">
                      Ada unit satuan (Indoor/Outdoor saja) yang harganya belum diisi.
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between border-t pt-2">
                    <span className="font-semibold">Total</span>
                    <span className="text-base font-bold text-primary">
                      {formatRupiah(grandTotal)}
                    </span>
                  </div>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={
                    checkoutMutation.isPending ||
                    lines.length === 0 ||
                    discountExceeds ||
                    hasUnpricedLine
                  }
                >
                  {checkoutMutation.isPending ? 'Memproses...' : 'Buat Transaksi'}
                </Button>
              </form>
            </Form>
          </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!pendingWarnings} onOpenChange={(open) => !open && setPendingWarnings(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingWarnings && pendingWarnings.length === 0 && pendingSingleUnits.length > 0
                ? 'Penjualan 1 unit dari paket AC'
                : 'Ada barang dijual di bawah/pas modal'}
            </DialogTitle>
            <DialogDescription>
              Transaksi belum tersimpan. Cek lagi baris di bawah ini sebelum lanjut.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-72 gap-3 overflow-y-auto">
            {/* Paket AC Split (2026-09-30) — modal restock dicatat per
                paket, gak dipecah per unit. */}
            {pendingSingleUnits.map((w, i) => (
              <div key={`single-${w.refId}-${i}`} className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm leading-relaxed dark:bg-amber-950/30">
                <p>
                  Modal total 1 paket <strong>{w.packageName}</strong> (Indoor + Outdoor):{' '}
                  <strong>{formatRupiah(w.packageBuyPrice)}</strong>
                </p>
                <p>
                  Anda menjual {w.qty > 1 ? `${w.qty} unit` : '1 unit'}{' '}
                  <strong>{w.unitRole === 'indoor' ? 'Indoor' : 'Outdoor'}</strong> ({w.name}) seharga{' '}
                  <strong>{formatRupiah(w.sellPrice)}</strong>
                  {w.qty > 1 ? ' per unit' : ''}.
                </p>
                <p className="mt-1 text-muted-foreground">Batal atau teruskan?</p>
              </div>
            ))}
            {pendingWarnings?.map((w, i) => (
              <div key={`${w.refId}-${i}`} className="rounded-md border p-3 text-sm">
                <p className="mb-1 font-medium">{w.name}</p>
                <SummaryRow label="Harga Modal" value={formatRupiah(w.buyPrice)} />
                <SummaryRow label="Harga Jual" value={formatRupiah(w.sellPrice)} />
                {w.discount > 0 && (
                  // "Diskon" di sini total gabungan — diskon baris ITU
                  // SENDIRI ditambah porsi diskon transaksi (kolom diskon di
                  // form bawah/voucher) yang keprorata ke baris ini, bukan
                  // cuma diskon per-baris doang (lihat fix backend
                  // pos.service.ts 2026-09-15).
                  <SummaryRow label="Diskon" value={formatRupiah(w.discount)} />
                )}
                <SummaryRow label="Harga Efektif" value={formatRupiah(w.effectivePrice)} />
                <div className="mt-1 flex items-center justify-between border-t pt-1 font-medium text-destructive">
                  <span>Rugi per Unit</span>
                  <span>{formatRupiah(w.buyPrice - w.effectivePrice)}</span>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingWarnings(null)}
              disabled={checkoutMutation.isPending}
            >
              Batal
            </Button>
            <Button type="button" onClick={confirmCheckout} disabled={checkoutMutation.isPending}>
              {checkoutMutation.isPending
                ? 'Memproses...'
                : pendingWarnings && pendingWarnings.length === 0 && pendingSingleUnits.length > 0
                  ? 'Teruskan'
                  : 'Tetap Proses Transaksi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

// Kartu grid item (Produk/Sparepart/Jasa gabungan) — padanan visual kartu
// produk di prototype "Transaksi Baru" (nama + subtitle stok + harga +
// tombol tambah), gantiin ItemRow/ItemList (tampilan list per-tab) yang lama.
//
// Paket AC Split (2026-09-30) — kartu 3 tombol (v2) dihapus, diganti tab
// Split/Indoor/Outdoor di atas grid. Tambahan: `priceLabel` (teks pengganti
// harga, mis. "Harga diisi manual" buat unit dari paket) & `badge`
// (status kartu Split: Lengkap / ⚠ Outdoor habis, dst). Badge SENGAJA gak
// ikut diredupin pas kartu disabled, biar peringatannya tetap kebaca.
function ItemCard({
  name,
  subtitle,
  price,
  priceLabel,
  badge,
  onAdd,
  disabled,
}: {
  name: string;
  subtitle?: string;
  price?: string;
  priceLabel?: string;
  badge?: { label: string; tone: 'ok' | 'warn' };
  onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors',
        !disabled && 'hover:border-primary hover:bg-accent',
      )}
    >
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className={cn(
          'flex w-full flex-col items-start gap-2 text-left',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <div className="flex w-full items-start justify-between gap-2">
          <p className="text-sm leading-tight font-medium">{name}</p>
          <span className="shrink-0 rounded-full bg-secondary p-1 text-secondary-foreground">
            <Plus className="size-3.5" />
          </span>
        </div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        {price !== undefined ? (
          <p className="text-sm font-semibold text-primary">{formatRupiah(price)}</p>
        ) : (
          priceLabel && <p className="text-xs font-medium text-amber-600">{priceLabel}</p>
        )}
      </button>
      {badge && (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            badge.tone === 'ok'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-red-100 text-red-700',
          )}
        >
          {badge.label}
        </span>
      )}
    </div>
  );
}

// Input qty kecil buat baris sparepart mode utuh/eceran (2026-09-30) —
// state teks lokal biar ngetik "2." / "2,5" gak di-reset tiap keystroke;
// nilai valid (> 0) langsung di-commit, sisanya dirapikan saat blur.
function QtyInput({
  value,
  integer,
  onCommit,
}: {
  value: number;
  integer: boolean;
  onCommit: (v: number) => void;
}) {
  // `draft` cuma ada selama user lagi ngetik; selebihnya ikut `value`.
  const [draft, setDraft] = React.useState<string | null>(null);
  const text = draft ?? String(value);
  return (
    <input
      inputMode={integer ? 'numeric' : 'decimal'}
      className="h-7 w-14 rounded-md border bg-background text-center text-sm font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring"
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.');
        if (!/^\d*\.?\d{0,2}$/.test(raw)) return;
        setDraft(raw);
        const n = Number(raw);
        if (raw !== '' && n > 0) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
