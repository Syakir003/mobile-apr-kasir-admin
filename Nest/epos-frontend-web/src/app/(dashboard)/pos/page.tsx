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
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
// baru dari Siklus batch-cost (2026-09): produk sekarang WAJIB nunjuk batch
// (`itemCostId`, dipilih lewat dialog di bawah — 1 produk bisa punya banyak
// batch harga beda). SERVER tetap yang resolve nama/harga final (lihat
// CheckoutItemDto/PosService backend) — harga di sini cuma buat pratinjau.
//
// Diskon SENGAJA cuma 1 (level-transaksi, di form ringkasan bawah) — bukan
// per-baris lagi. Backend (CheckoutItemDto.discount) masih nerima diskon
// per-item kalau dikirim, tapi UI ini sekarang gak pernah ngirim itu (selalu
// undefined) biar kasir gak bingung mikirin diskon di 2 tempat beda.

interface Product {
  id: string;
  name: string;
  brand: string | null;
  // Agregat dari ProductsService.priceAggFor — BUKAN kolom langsung lagi
  // (Siklus batch-cost 2026-09), lihat komentar sama di master/produk &
  // stock/stock-client.
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
  // Wajib buat kind='product' — batch (ItemCost) yang dipilih lewat dialog
  // BatchPicker. Nentuin harga jual & modal baris ini, jadi 2 baris produk
  // yang sama TAPI beda batch dianggap baris terpisah (lihat lineMatchKey).
  itemCostId?: string;
  name: string;
  unit: string;
  unitPrice: number;
  qty: number;
  // Diambil dari batch.stock pas baris ditambah — cuma buat cap tombol "+"
  // di UI (soft guard), validasi beneran tetap di server (StockLockingService).
  availableStock?: number;
  withInstallation: boolean;
  roomLocation: string;
  // Paket instalasi (opsional) buat baris ini — dipakai buat SEMUA unit di
  // baris ini kalau qty > 1 (1 baris = 1 pilihan paket, bukan per-unit).
  packageId?: string;
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
interface CheckoutConfirmResult {
  status: 'confirm_required';
  warnings: CheckoutWarning[];
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

// Kunci unik per BARIS cart. Produk dikunci pakai itemCostId (BUKAN refId)
// — 2 baris produk sama tapi beda batch harus tetap 2 baris terpisah, sama
// kayak `lineKey()` di PosService backend.
function lineMatchKey(l: { kind: CartItemKind; refId: string; itemCostId?: string }): string {
  return l.kind === 'product' ? `product:${l.itemCostId}` : `${l.kind}:${l.refId}`;
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

export default function PosPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [search, setSearch] = React.useState('');
  // Produk yang lagi dipilih buat nentuin batch mana yang mau ditambah ke
  // keranjang — dialog BatchPicker di bawah muncul selama ini gak null.
  const [batchPickerProduct, setBatchPickerProduct] = React.useState<Product | null>(null);
  // Diisi kalau checkout balik status confirm_required (ada baris produk
  // yang efektif dijual di bawah/pas modal). null = dialog konfirmasi tertutup.
  const [pendingWarnings, setPendingWarnings] = React.useState<CheckoutWarning[] | null>(null);

  // Pencarian member LAMA (opsional) — kalau kasir milih salah satu, nama/
  // HP/alamat di form otomatis keisi dan checkout nanti dikirim dengan
  // memberId eksplisit (bukan ngandelin pencocokan by-phone di backend).
  const [selectedMember, setSelectedMember] = React.useState<MemberSearchResult | null>(null);
  const [memberSearch, setMemberSearch] = React.useState('');
  const [memberSearchDebounced, setMemberSearchDebounced] = React.useState('');
  // Kode voucher (opsional) — ketik manual kasir, PERSIS kayak app mobile
  // (bukan dropdown pilihan voucher yang udah "diklaim" member). Voucher
  // tetap nempel ke satu member sejak dibuat admin, tapi validasi itu
  // (kode cocok member yang mana) sepenuhnya di server saat checkout —
  // field ini gak digating oleh ada/tidaknya member yang dipilih.
  const [voucherCode, setVoucherCode] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setMemberSearchDebounced(memberSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [memberSearch]);

  const memberSearchQuery = useQuery({
    queryKey: ['members-search', memberSearchDebounced],
    queryFn: () =>
      apiClient.get<MemberSearchResult[]>(
        `/members/search?q=${encodeURIComponent(memberSearchDebounced)}`,
      ),
    enabled: memberSearchDebounced.length > 0,
  });

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

  const batchesQuery = useQuery({
    queryKey: ['product-batches', batchPickerProduct?.id],
    queryFn: () => apiClient.get<ProductBatch[]>(`/products/${batchPickerProduct!.id}/batches`),
    enabled: !!batchPickerProduct,
  });

  // GET /installation-packages udah filter active:true di server — gak
  // perlu difilter lagi di sini.
  const packagesQuery = useQuery({
    queryKey: ['installation-packages'],
    queryFn: () => apiClient.get<InstallationPackageOption[]>('/installation-packages'),
  });

  function addLine(line: CartLine) {
    setLines((prev) => mergeLine(prev, line));
    toast.success(`${line.name} ditambahkan ke keranjang.`);
  }

  function addProductBatchLine(batch: ProductBatch) {
    if (!batchPickerProduct) return;
    addLine({
      kind: 'product',
      refId: batchPickerProduct.id,
      itemCostId: batch.id,
      name: batchPickerProduct.name,
      unit: 'unit',
      unitPrice: Number(batch.sellPrice),
      qty: 1,
      availableStock: batch.stock,
      withInstallation: false,
      roomLocation: '',
      packageId: undefined,
    });
    setBatchPickerProduct(null);
  }

  function setQty(index: number, qty: number) {
    if (qty <= 0) return;
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const capped = l.availableStock != null ? Math.min(qty, l.availableStock) : qty;
        return { ...l, qty: capped };
      }),
    );
  }

  function removeAt(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleInstallation(index: number, value: boolean) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, withInstallation: value } : l)));
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
    setMemberSearch('');
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

  const checkoutMutation = useMutation({
    mutationFn: async (values: CheckoutFormValues & { confirmOverride?: boolean }) => {
      const discount = values.discount?.trim() ? Number(values.discount) : 0;
      const taxPercent = values.taxPercent?.trim() ? Number(values.taxPercent) : 0;
      const transportFee = values.transportFee?.trim() ? Number(values.transportFee) : 0;

      const installations: { itemIndex: number; roomLocation?: string; packageId?: string }[] =
        [];
      lines.forEach((line, index) => {
        if (line.kind !== 'product' || !line.withInstallation) return;
        // Satu entri instalasi PER UNIT (qty produk selalu bilangan bulat,
        // sama seperti aturan CheckoutItemDto backend) — sama seperti
        // buildCheckoutPayload di Flutter (satu unit AC = satu job teknisi).
        // Paket instalasi yang dipilih di baris ini (kalau ada) dipasang ke
        // SEMUA unit di baris ini — server bikin 1 set item paket per unit.
        for (let j = 0; j < line.qty; j++) {
          installations.push({
            itemIndex: index,
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
          itemCostId: l.kind === 'product' ? l.itemCostId : undefined,
          qty: l.qty,
          // Diskon per-item SENGAJA gak pernah dikirim dari sini lagi —
          // cuma ada 1 diskon (level-transaksi, `discount` di bawah).
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
        return;
      }
      toast.success(`Transaksi dibuat: ${result.invoiceNumber}`);
      setLines([]);
      form.reset();
      setSelectedMember(null);
      setMemberSearch('');
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
      // pilihan cetak (Invoice/Surat Jalan/Label Unit) lewat PrintMenu,
      // jadi gak ada yang ketinggalan dibanding banner sukses yang lama.
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
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_400px]">
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
            <Tabs defaultValue="product">
              <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="product">Produk</TabsTrigger>
                  <TabsTrigger value="sparepart">Sparepart</TabsTrigger>
                  <TabsTrigger value="service">Jasa</TabsTrigger>
                </TabsList>
                <TabsContent value="product" className="mt-3">
                  <ItemList
                    isLoading={productsQuery.isLoading}
                    isEmpty={filteredProducts.length === 0}
                    emptyLabel="Tidak ada produk."
                  >
                    {filteredProducts.map((p) => {
                      const outOfStock = p.stock <= 0;
                      return (
                        <ItemRow
                          key={p.id}
                          name={p.name}
                          subtitle={
                            outOfStock
                              ? 'Belum ada stok — input dulu lewat Barang Masuk'
                              : `Stok: ${p.stock}${p.brand ? ` • ${p.brand}` : ''}${
                                  p.sellPriceMax && p.sellPriceMax !== p.sellPriceMin
                                    ? ` • s.d. ${formatRupiah(p.sellPriceMax)}`
                                    : ''
                                }`
                          }
                          price={outOfStock ? undefined : String(p.sellPriceMin ?? 0)}
                          disabled={outOfStock}
                          onAdd={() => setBatchPickerProduct(p)}
                        />
                      );
                    })}
                  </ItemList>
                </TabsContent>
                <TabsContent value="sparepart" className="mt-3">
                  <ItemList
                    isLoading={sparepartsQuery.isLoading}
                    isEmpty={filteredSpareparts.length === 0}
                    emptyLabel="Tidak ada sparepart."
                  >
                    {filteredSpareparts.map((s) => (
                      <ItemRow
                        key={s.id}
                        name={s.name}
                        subtitle={`Stok: ${s.stock} ${s.unit}`}
                        price={s.sellPrice}
                        onAdd={() =>
                          addLine({
                            kind: 'sparepart',
                            refId: s.id,
                            name: s.name,
                            unit: s.unit,
                            unitPrice: Number(s.sellPrice),
                            qty: 1,
                            withInstallation: false,
                            roomLocation: '',
                          })
                        }
                      />
                    ))}
                  </ItemList>
                </TabsContent>
                <TabsContent value="service" className="mt-3">
                  <ItemList
                    isLoading={servicesQuery.isLoading}
                    isEmpty={filteredServices.length === 0}
                    emptyLabel="Tidak ada jasa."
                  >
                    {filteredServices.map((s) => (
                      <ItemRow
                        key={s.id}
                        name={s.name}
                        subtitle={s.category ?? undefined}
                        price={s.basePrice}
                        onAdd={() =>
                          addLine({
                            kind: 'service',
                            refId: s.id,
                            name: s.name,
                            unit: 'jasa',
                            unitPrice: Number(s.basePrice),
                            qty: 1,
                            withInstallation: false,
                            roomLocation: '',
                          })
                        }
                      />
                    ))}
                  </ItemList>
                </TabsContent>
              </Tabs>
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
                          <p className="text-sm font-medium">{line.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatRupiah(line.unitPrice)} / {line.unit}
                          </p>
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
                          <span className="w-6 text-center text-sm font-medium">{line.qty}</span>
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
                <div className="grid gap-1.5">
                  <FormLabel>Member</FormLabel>
                  {selectedMember ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{selectedMember.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {selectedMember.phone || 'Tanpa nomor HP'}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={clearSelectedMember}>
                        Ganti
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Cari nama/HP member lama, atau kosongkan buat pelanggan baru"
                        className="pl-9"
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                      />
                      {memberSearch.trim() && (
                        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
                          {memberSearchQuery.isLoading && (
                            <p className="p-2 text-xs text-muted-foreground">Mencari...</p>
                          )}
                          {memberSearchQuery.data?.length === 0 && (
                            <p className="p-2 text-xs text-muted-foreground">
                              Gak ketemu — isi manual di bawah buat pelanggan baru.
                            </p>
                          )}
                          {memberSearchQuery.data?.map((m) => (
                            <button
                              type="button"
                              key={m.id}
                              onClick={() => selectMember(m)}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                            >
                              <p className="font-medium">{m.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {m.phone || 'Tanpa nomor HP'}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

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
                  <div className="mt-2 flex items-center justify-between border-t pt-2">
                    <span className="font-semibold">Total</span>
                    <span className="text-base font-bold text-primary">
                      {formatRupiah(grandTotal)}
                    </span>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={checkoutMutation.isPending || lines.length === 0 || discountExceeds}
                >
                  {checkoutMutation.isPending ? 'Memproses...' : 'Buat Transaksi'}
                </Button>
              </form>
            </Form>
          </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={!!batchPickerProduct}
        onOpenChange={(open) => !open && setBatchPickerProduct(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pilih Batch — {batchPickerProduct?.name}</DialogTitle>
            <DialogDescription>
              Produk ini bisa punya beberapa batch dengan harga jual beda. Pilih batch yang mau
              dijual buat baris ini.
            </DialogDescription>
          </DialogHeader>
          {batchesQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Memuat batch...</p>
          ) : !batchesQuery.data || batchesQuery.data.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Belum ada batch aktif — input dulu lewat halaman Barang Masuk.
            </p>
          ) : (
            <div className="grid max-h-72 gap-1 overflow-y-auto">
              {batchesQuery.data.map((b) => (
                <button
                  type="button"
                  key={b.id}
                  onClick={() => addProductBatchLine(b)}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                >
                  <div>
                    <p className="text-sm font-medium">Stok: {b.stock}</p>
                    {b.supplierName && (
                      <p className="text-xs text-muted-foreground">{b.supplierName}</p>
                    )}
                  </div>
                  <Badge variant="secondary">{formatRupiah(b.sellPrice)}</Badge>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingWarnings} onOpenChange={(open) => !open && setPendingWarnings(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ada barang dijual di bawah/pas modal</DialogTitle>
            <DialogDescription>
              Transaksi belum tersimpan. Cek lagi baris di bawah ini sebelum lanjut.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-72 gap-3 overflow-y-auto">
            {pendingWarnings?.map((w, i) => (
              <div key={`${w.itemCostId ?? w.refId}-${i}`} className="rounded-md border p-3 text-sm">
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
              {checkoutMutation.isPending ? 'Memproses...' : 'Tetap Proses Transaksi'}
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

function ItemList({
  isLoading,
  isEmpty,
  emptyLabel,
  children,
}: {
  isLoading: boolean;
  isEmpty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>;
  }
  if (isEmpty) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return <div className="grid max-h-64 gap-1 overflow-y-auto">{children}</div>;
}

function ItemRow({
  name,
  subtitle,
  price,
  onAdd,
  disabled,
}: {
  name: string;
  subtitle?: string;
  price?: string;
  onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors ${
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent'
      }`}
    >
      <div>
        <p className="text-sm font-medium">{name}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {price !== undefined && <Badge variant="secondary">{formatRupiah(price)}</Badge>}
    </button>
  );
}
