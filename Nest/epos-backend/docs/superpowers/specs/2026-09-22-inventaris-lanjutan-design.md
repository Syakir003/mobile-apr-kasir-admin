
# Spec: Inventaris Lanjutan (Harga Seragam, AC Indoor/Outdoor, Sparepart Per-Gulungan, Laporan Stok)

Status: disetujui user 2026-09-22, siap ditulis jadi plan implementasi.

Urutan build yang disepakati: **Point 1 → Point 3 → Point 2 → Point 4**.

---

## Point 1 — Harga Jual Seragam per Produk

### Masalah sekarang
Sejak "Siklus batch-cost 2026-09", tiap batch (`ItemCost`) punya `sellPrice` sendiri-sendiri — jadi 1 produk yang stoknya datang dari 3 supplier beda bisa punya 3 harga jual aktif berbeda sekaligus. Realitanya toko cuma mau 1 harga jual per produk, gak peduli itu stok dari supplier mana.

### Keputusan
- `Product` nambah kolom `sellPrice` (Decimal) — harga jual SERAGAM, berlaku ke semua batch produk itu.
- `ItemCost` (batch) tetap nyimpen `buyPrice` sendiri-sendiri per batch (beda supplier/kedatangan = beda modal). Kolom `ItemCost.sellPrice` gak dipakai lagi buat `kind='product'` (dibiarin ada di skema, gak di-drop, biar gak ada migrasi destruktif — batch baru gak diisi/diabaikan).
- Checkout jadi **FIFO otomatis** lintas batch (pakai `StockLockingService.lockAndDeduct`, method yg udah ada) — HAPUS alur manual pilih batch (`lockAndDeductProductBatch` + dialog "Pilih Batch" di POS).
- Warning "jual di bawah modal": banding `Product.sellPrice` (dikurangi diskon efektif) vs **MAX(buyPrice)** dari semua batch yang MASIH ADA STOKNYA (skenario terburuk) — bukan cuma batch yang kena FIFO-deduct.
  - Dicek di 2 tempat: (a) checkout, (b) barang masuk (buyPrice batch baru vs `Product.sellPrice` yang udah ada).
  - Bonus: dicek juga pas admin ubah `Product.sellPrice` di Master Data (opsional tapi murah, reuse helper yang sama).
- **Harga jual bisa diedit manual pas checkout** — kasir/siapapun yang pegang kasir (gak dibatasi role admin) bisa langsung ubah angka harga jual di baris cart. Field diskon per-baris yang udah ada tetap terpisah (bisa dipakai bareng). Warning below-cost tetap jalan berdasarkan harga FINAL yang beneran dipakai (override − diskon), dibanding ke MAX(buyPrice).
  - Backend: `CheckoutItemDto` nambah field opsional `unitPriceOverride`. Kalau dikirim, dipakai sebagai `unitPrice` baris itu. Kalau kosong, fallback ke `Product.sellPrice`.

### Migrasi data lama
`Product.sellPrice` di-backfill dari `sellPrice` batch TERBARU/aktif yang ada sekarang per produk, biar gak kosong begitu kolom baru ini dipakai.

### Form yang berubah
- **Barang Masuk (stock-in)** kind=product: field "Harga Jual" DIHAPUS dari form — cuma Harga Modal + Supplier.
- **Master Data > Produk** (create & edit): field baru "Harga Jual" — satu-satunya tempat atur harga jual produk sekarang.
- List/detail produk: `sellPriceMin`/`sellPriceMax` (agregat lama) diganti tampilan `product.sellPrice` langsung.

### File yang kesentuh
Backend: `schema.prisma` (+migration `Product.sellPrice`, backfill), `pos.service.ts` (ganti ke `lockAndDeduct`, `lineKey` jadi berbasis `refId`, tambah `unitPriceOverride`, below-cost pakai MAX buyPrice), `stock-locking.service.ts` (`lockAndDeduct` product branch balikin `maxBuyPrice` bukan cuma harga batch pertama), `stock.service.ts`, `stock-in.dto.ts` (hapus `sellPrice` utk product), `checkout.dto.ts` (+`unitPriceOverride`, `itemCostId` gak dipakai lagi utk product), `products.service.ts` (`priceAggFor` disederhanakan), `create-product.dto.ts`/`update-product.dto.ts` (+`sellPrice`).
Frontend: `pos/page.tsx` (hapus dialog BatchPicker, `lineMatchKey` berbasis refId, input harga jual editable per baris), Master Data Produk (form +field Harga Jual), halaman Barang Masuk (hapus field Harga Jual produk).

> Plan implementasi lengkap (TDD, per-file): `docs/superpowers/plans/2026-09-22-harga-jual-seragam-plan.md`

---

## Point 3 — Sparepart Per-Gulungan (batch, dijual meteran)

### Masalah sekarang
Sparepart kayak Pipa datang per gulungan (misal 30m/gulungan), tapi stok sekarang cuma angka flat total di `Sparepart.stock`. Real di lapangan: jual 10m harus motong dari SATU gulungan spesifik (nyisain gulungan itu jadi 20m), bukan sekadar ngurangin total.

### Keputusan
- `Sparepart` nambah kolom `batchTracked` (boolean, default false) — diset admin pas bikin/edit sparepart. Sparepart biasa (baut, kapasitor, dll) TETAP flat stock kayak sekarang. Sparepart kayak Pipa/Kabel dicentang, baru ikut sistem batch.
- Sparepart `batchTracked=true` ikut sistem `ItemCost` kayak produk — invarian lama "sparepart cuma 1 baris ItemCost" cuma berlaku buat yang `batchTracked=false`.
- **Barang Masuk** utk sparepart batch-tracked: admin isi jumlah gulungan + panjang PER gulungan (bisa beda-beda tiap kedatangan, gak ada default tersimpan) + 1 harga modal (berlaku sama ke semua gulungan kedatangan itu). Backend bikin N baris `ItemCost` terpisah, masing-masing `stock` = panjang gulungan itu sendiri (BUKAN 1 baris gabungan/dijumlah).
- `ItemCost.stock` ganti tipe dari `Int` ke `Decimal` (buat nampung sisa meteran pecahan). Gak ngaruh ke produk (tetep bilangan bulat, cuma lewat tipe Decimal).
- **Jual/pakai barang** (checkout & pengajuan material teknisi): kasir/teknisi tinggal masukin qty meter — sistem AUTO FIFO motong dari gulungan TERTUA dulu (bisa "nembus" ke gulungan berikutnya kalau qty > sisa 1 gulungan). Gak ada pemilihan gulungan manual.
- Harga jual sparepart TETAP dari `Sparepart.sellPrice` (satu harga per meter, gak kena efek Point 1 — itu cuma buat Product).
- Stock opname sparepart batch-tracked jadi per-gulungan (`itemCostId`), reuse pola yang udah ada buat opname produk.

### File yang kesentuh
Backend: `schema.prisma` (+`Sparepart.batchTracked`, `ItemCost.stock` Int→Decimal), `stock-locking.service.ts` (cabang baru: sparepart batch-tracked pakai jalur FIFO kayak produk), `stock.service.ts` (stockIn sparepart cabang baru bikin N batch, opname per-batch), `spareparts.service.ts` + DTO (+`batchTracked`).
Frontend: `stock-client.tsx` (form barang masuk sparepart jadi dinamis — kalau batchTracked minta jumlah+panjang gulungan, nampilin tabel gulungan aktif), Master Data Sparepart (toggle batchTracked). POS/pengajuan material sisi kasir/teknisi gak berubah banyak — tetap input qty meter biasa.

---

## Point 2 — AC Indoor/Outdoor Berpasangan

### Masalah sekarang
AC punya 2 komponen fisik terpisah (Indoor & Outdoor, misal FT2YV & FD2YV) yang masing-masing punya kode produk sendiri, tapi secara bisnis dihitung SATU unit AC — satu harga modal, satu harga jual, satu unit yang keliatan di riwayat customer.

### Keputusan
- Indoor & Outdoor tetap 2 `Product` terpisah (gak digabung jadi 1 entity) — masing-masing punya batch/stok sendiri, karena BISA dijual terpisah juga (ganti salah satu komponen doang).
- `Product` nambah field opsional `pairedProductId` (self-relation) — diisi di Master Data Produk buat nunjuk pasangannya, dipakai auto-suggest doang, tetap bisa diganti manual pas transaksi.
- **Barang Masuk & POS** sama-sama pakai mode pilihan MANUAL (bukan deteksi otomatis): **"Unit Lengkap (Indoor+Outdoor)" / "Indoor saja" / "Outdoor saja"**.
- **Harga & modal nempel di sisi Indoor** (produk utama), Outdoor = Rp 0/gak dipakai:
  - Mode Lengkap barang masuk: 1 field "Harga Modal" combo → nempel ke batch Indoor. Batch Outdoor otomatis modal Rp 0 (cuma buat catetan potong stok).
  - Mode Lengkap checkout: 1 harga jual combo (`Product.sellPrice` milik Indoor, bisa diedit manual pas checkout sesuai Point 1) → baris Indoor kepasang harga combo, baris Outdoor otomatis Rp 0 (gak nambah ke total, biar gak dobel hitung).
  - `Product.sellPrice`/batch Outdoor tetap ada & dipakai NORMAL kalau Outdoor dijual/diganti SENDIRIAN (mode "Outdoor saja").
  - Warning below-cost mode Lengkap otomatis cuma dari sisi Indoor (modal combo vs jual combo) — sisi Outdoor gak pernah warning karena modalnya 0.
- **Stok gak lengkap**: mode Lengkap tapi stok salah satu sisi abis pas checkout → **DIBLOKIR** (bukan cuma warning), pesan jelas sisi mana yang abis (misal "Outdoor FD2YV stok habis — unit gak lengkap").
- **Pencatatan Unit AC customer**: mode Lengkap → SATU `MemberAcUnit` gabungan (1 QR/barcode servis, `brand`/`model`/`pk` keisi gabungan info Indoor+Outdoor). `MemberAcUnit` nambah 2 kolom opsional referensi `indoorProductId`/`outdoorProductId` biar traceable ke produk asli. Mode Indoor-saja/Outdoor-saja → tetap 1 `MemberAcUnit` baru, cuma salah satu kolom referensi keisi.
  - Catatan scope: kasus "ganti outdoor DARI unit lama yang udah ada" (bukan unit baru) itu edit manual lewat halaman Unit AC yang udah ada — TIDAK masuk scope ini.
- **Penandaan movement buat laporan per-Unit (dipakai Point 4)**: `StockMovement` nambah kolom opsional `pairGroupId` (string, mis. UUID) — diisi SAMA buat 2 baris movement Indoor & Outdoor yang lahir dari SATU aksi "Unit Lengkap" (baik barang masuk maupun penjualan). Movement dari mode Indoor-saja/Outdoor-saja dibiarkan null.

**Klarifikasi 2026-09-23 (tampilan Master Data Produk):** "Sub produk" yang
diusulkan user CUMA perubahan TAMPILAN/pengelompokan di halaman Master Data
Produk, BUKAN perubahan model data. Indoor & Outdoor TETAP 2 entity `Product`
yang sepenuhnya independen (stok/harga/bisa dijual terpisah sendiri-sendiri).
Produk yang jadi target `pairedProductId` produk lain (sisi Outdoor)
di-nested/collapse di bawah baris Indoor-nya di list utama Master Data
(pola sama seperti "gulungan aktif" nested di bawah sparepart, Point 3) —
BUKAN ditampilkan sebagai baris sendiri. Outdoor TETAP full searchable/
sellable sebagai Product independen di POS/Barang Masuk (mode "Outdoor
saja") — cuma gak nongol di list utama Master Data.

### File yang kesentuh
Backend: `schema.prisma` (+`Product.pairedProductId`, +`MemberAcUnit.indoorProductId`/`outdoorProductId`, +`StockMovement.pairGroupId`), `ac-units.service.ts` (`createForInstallation` terima 1 atau 2 produk), `pos.service.ts` (`installations[]` DTO: dari 1 `itemIndex` jadi grup `itemIndexes[]`; validasi stok lengkap sebelum commit; generate `pairGroupId` pas mode Lengkap), `stock.service.ts` + `stock-in.dto.ts` (mode Lengkap bikin 2 batch sekaligus + `pairGroupId` sama, modal cuma di Indoor).
Frontend: `stock-client.tsx` & `pos/page.tsx` (UI pilih mode unit + pesan blokir stok gak lengkap), Master Data Produk (field pasangan unit + tampilan nested Indoor/Outdoor seperti klarifikasi di atas).

---

## Point 4 — Laporan Stok (Audit/Opname)

### Kebutuhan
Laporan per item: **Stok Awal, Stok Masuk, Stok Keluar, Sisa Stok, Value Stok** (total modal barang yang masih ada + total yang udah kejual & untungnya), filter range tanggal, bisa export PDF. Dipakai buat cocokin stok sistem vs stok fisik (opname).

### Keputusan umum
- Endpoint baru `GET /reports/stock-movements` (nama final ditentukan pas plan), filter `from`/`to` (wajib) + filter item opsional (kind/refId/kategori).
- Per item, dihitung dari gabungan 3 sumber:
  - `StockMovement` — buat Stok Masuk (sum `qtyChange` positif dalam range) & Stok Keluar (sum `qtyChange` negatif dalam range), dan Stok Awal (saldo dari semua movement SEBELUM `from`).
  - `ItemCost`/`Sparepart` — buat Sisa Stok & modal saat ini.
  - `InvoiceItem` (pakai `buyPriceSnapshot` vs `unitPrice`, filter by tanggal invoice dalam range) — buat "total yang udah kejual" & untungnya.
- **Value Stok** = 2 angka terpisah (bukan 1 angka gabungan), sesuai keputusan user: (a) total modal barang yang MASIH ADA stoknya sekarang, (b) total omzet + total untung dari yang udah TERJUAL dalam range tanggal itu.
- Export PDF: pola print-friendly kayak halaman invoice yang udah ada (bukan library PDF baru kalau bisa reuse pattern yang sama).

### Tampilan khusus produk AC berpasangan (`pairedProductId` keisi)
Untuk produk yang berpasangan (Point 2), laporan nampilin **3 baris terpisah**, bukan cuma 1:
- **Baris Indoor** & **Baris Outdoor** — stok masuk/keluar/sisa dari SEMUA aksi (mode Lengkap + standalone digabung), persis kayak produk biasa lainnya (dari `StockMovement` apa adanya, gak dipilah).
- **Baris "Unit [nama pasangan]"** (gabungan, baris tambahan khusus AC berpasangan):
  - Stok Masuk Unit = jumlah qty dari `StockMovement` yang share `pairGroupId` sama, alasan barang masuk, dalam range tanggal (ambil qty dari salah satu sisi aja per grup, karena Indoor & Outdoor selalu sama qty-nya dalam 1 aksi Lengkap).
  - Stok Keluar Unit = sama, tapi alasan penjualan.
  - Sisa Unit = **MIN(sisa stok Indoor saat ini, sisa stok Outdoor saat ini)** — "berapa unit LENGKAP yang bisa langsung dipasang sekarang", dihitung on-the-fly dari sisa masing-masing komponen, bukan disimpan sebagai angka terpisah.

### File yang kesentuh
Backend: module baru `src/reports/` (atau nambah ke module yang relevan kalau udah ada — dicek pas plan) — service query gabungan 3 sumber di atas + DTO filter tanggal/item + logic grouping `pairGroupId` buat baris Unit.
Frontend: halaman baru "Laporan Stok" (filter tanggal + tabel — baris Unit AC ditampilin menjorok/dikelompokkan di bawah baris Indoor+Outdoor pasangannya — + tombol print/export PDF).

---

## Catatan umum
- Semua 4 poin di atas SALING BERGANTUNG sebagian (Point 3 & Point 2 sama-sama numpang di infrastruktur batch `ItemCost` yang diubah Point 1), makanya urutan build Point 1 → Point 3 → Point 2 → Point 4 penting, gak bisa dibalik/paralel bebas.
- Tiap poin akan ditulis jadi plan implementasi terpisah (`writing-plans`) & dieksekusi satu-satu, BUKAN sekaligus 4 poin dalam 1 plan besar.
