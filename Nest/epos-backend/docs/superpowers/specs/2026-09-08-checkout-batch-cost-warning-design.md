# Desain: Warning Harga Jual di Bawah Modal (Batch Cost Tracking)

**Tanggal:** 2026-09-08
**Status:** Backend selesai diimplementasi (2026-09-08). FE POS menyusul di plan terpisah.
**Modul terdampak:** `stock`, `pos` (checkout), `products` (schema & katalog), `reports`

## 1. Masalah

Toko bisa beli 1 produk (unit AC) yang sama dari beberapa supplier dalam
waktu berdekatan, dengan harga modal berbeda-beda, lalu digabung jadi 1
stok. Contoh nyata yang jadi acuan:

| Supplier | Harga modal | Harga jual normal |
|---|---|---|
| Toko A | 3.100.000 | 3.200.000 |
| Toko B | 3.000.000 | 3.100.000 |
| Toko C | 2.900.000 | 3.000.000 |

Skema sekarang (`item_costs`) cuma nyimpen **1 nilai** `buyPrice` per
produk, dan tiap barang masuk baru (`stockIn`) **menimpa** nilai lama
(`upsert`). Akibatnya sistem gak bisa tahu produk yang lagi dijual itu
sebetulnya dari batch modal yang mana, jadi gak bisa ngasih warning yang
akurat kalau kasir kasih diskon/harga yang bikin toko rugi di batch
tertentu.

## 2. Tujuan

- Toko bisa nyimpen banyak "batch" harga modal+jual sekaligus per produk.
- Sistem ngasih **warning real-time** (sebelum data ke-commit) kalau harga
  jual efektif (setelah diskon per-item) ada di bawah atau sama dengan
  modal batch yang dipilih — baik pas **checkout** maupun pas **barang
  masuk** (stock-in).
- Warning ini gak ngeblokir keras — kasir/admin bisa confirm & lanjut
  kalau memang disengaja (misal cuci gudang).

## 3. Non-Tujuan (Scope)

- **Sparepart TIDAK ikut** sistem batch ini. Sparepart tetap 1 harga modal
  simpel kayak sekarang (upsert 1 baris `item_costs`).
- Gak ada perubahan ke alur voucher, diskon level-transaksi yang udah ada,
  atau alur instalasi paket — semua itu tetap seperti sekarang, cuma
  ditambah diskon per-item di sampingnya.
- Gak ada fitur hapus/edit batch yang udah dibuat (kalau ada salah input,
  ditangani lewat opname seperti biasa, bukan bagian dari spec ini).

## 4. Keputusan Desain

1. **`item_costs` direstruktur** jadi tabel batch: PK berubah dari
   `[kind, refId]` (unique, cuma 1 baris) jadi `id` sendiri (boleh banyak
   baris per `refId`). Kolom `sellPrice` & `stock` pindah dari `Product`
   ke sini.
2. Untuk `kind='product'`: **boleh banyak baris** per `refId` (1 baris =
   1 batch/kedatangan). Untuk `kind='sparepart'`: **tetap dijaga di kode
   cuma 1 baris** per `refId` (upsert, gak berubah dari sekarang).
3. Diskon dipecah jadi 2 tingkat yang **numpuk, bukan gantiin**: diskon
   per-item (baru, kolom `discount` di `TransactionItem`/`InvoiceItem`)
   dan diskon level-transaksi (yang udah ada, gak berubah).
4. Threshold warning: `hargaEfektif <= buyPrice` (breakeven dianggap kena
   warning juga, bukan cuma yang di bawahnya).
5. Pola warning: **soft-warn + confirm**, bukan hard block. Response
   pertama (tanpa `confirmOverride`) balikin HTTP 200 dengan payload
   warning, BUKAN exception. Request diulang dengan `confirmOverride:
   true` buat benar-benar commit.
6. Warning berlaku di **2 tempat**: checkout (bandingin ke batch yang
   dipilih kasir) dan stock-in (bandingin `sellPrice` vs `buyPrice` yang
   diinput admin/kasir pas input barang masuk baru).
7. **Yang boleh confirm override**: role yang sama yang punya akses
   checkout — **admin & kasir**. Berlaku sama di checkout maupun stock-in.
8. **Pemilihan batch di POS**: manual oleh kasir (bukan auto-FIFO/auto-
   termurah), lewat **dialog/popup** — klik produk yang punya >1 batch
   aktif, muncul popup list batch (harga + sisa stok), pilih satu → masuk
   keranjang. Kalau produk cuma punya 1 batch aktif, langsung masuk
   keranjang tanpa popup.
9. **Tampilan harga di katalog**: range `MIN(sellPrice)`–`MAX(sellPrice)`
   dari batch aktif (`stock > 0`). Kalau cuma 1 batch aktif, otomatis
   tampil 1 angka.

## 5. Data Model

```prisma
model Product {
  id          String   @id @default(uuid())
  sku         String?  @unique
  name        String
  brand       String?
  type        String?
  pk          Decimal? @db.Decimal(4, 2)
  inverter    Boolean  @default(false)
  btu         Int?
  watt        Int?
  warranty    String?
  photoUrl    String?  @map("photo_url")
  description String?
  category    String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now()) @map("created_at")
  // sellPrice & stock DIHAPUS dari sini, pindah ke ItemCost (batch)
  @@map("products")
}

model ItemCost {
  id           String   @id @default(uuid())
  kind         String   // 'product' | 'sparepart'
  refId        String   @map("ref_id")
  supplierName String?  @map("supplier_name")
  buyPrice     Decimal  @map("buy_price") @db.Decimal(14, 2)
  sellPrice    Decimal  @map("sell_price") @db.Decimal(14, 2)
  stock        Int      // sisa stok batch ini (product) ATAU stok total (sparepart)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([kind, refId])
  @@map("item_costs")
}

model TransactionItem {
  // ...kolom existing...
  discount Decimal @default(0) @map("discount") @db.Decimal(14, 2) // BARU
}

model InvoiceItem {
  // ...kolom existing...
  discount Decimal @default(0) @map("discount") @db.Decimal(14, 2) // BARU
}

model StockMovement {
  // ...kolom existing...
  itemCostId String? @map("item_cost_id") // BARU, opsional — nunjuk batch spesifik kalau kind='product'
}
```

Query stok total & harga range produk (dipakai katalog/listing):
```sql
SELECT SUM(stock) AS total_stock, MIN(sell_price) AS min_price, MAX(sell_price) AS max_price
FROM item_costs
WHERE kind = 'product' AND ref_id = $1 AND stock > 0
```

## 6. Alur Barang Masuk (Stock-In)

`StockInDto` nambah field (khusus `kind='product'`):
```ts
{
  kind: 'product' | 'sparepart',
  refId: string,
  qty: number,
  buyPrice: number,
  sellPrice?: number,       // wajib kalau kind='product'
  supplierName?: string,
  note?: string,
  confirmOverride?: boolean,
}
```

- `kind='sparepart'` → alur **tidak berubah** (upsert 1 baris `item_costs`,
  `sellPrice`/`stock` tetap di tabel `spareparts`).
- `kind='product'` → **selalu INSERT baris `item_costs` baru** (batch
  baru), bukan update. Sebelum commit: kalau `sellPrice <= buyPrice` dan
  `confirmOverride` bukan `true` → balikin response 200 berisi
  `{ requiresConfirmation: true, buyPrice, sellPrice, message }`, TIDAK
  ada `StockMovement`/`AuditLog` yang dibuat. Kalau `confirmOverride:
  true` atau `sellPrice > buyPrice` → baris batch dibuat, `StockMovement`
  + `AuditLog` dicatat (termasuk flag kalau ini hasil override).
- Locking: INSERT baris baru gak butuh `FOR UPDATE` (gak ada counter yang
  dibagi bareng, beda dari `sparepart` yang masih pola lama).

## 7. Alur Checkout

`CheckoutItemDto` nambah field:
```ts
{
  kind: 'product' | 'sparepart' | 'service',
  refId: string,
  itemCostId?: string,   // wajib kalau kind='product' — id batch yang dipilih kasir
  qty: number,
  discount?: number,     // BARU, diskon nominal khusus baris ini
}
```

`CheckoutDto` nambah `confirmOverride?: boolean` di level root (berlaku
buat semua baris yang kena warning dalam 1 checkout, bukan per-baris).

Langkah backend:
1. Tiap item `kind='product'`: lock baris `item_costs` sesuai
   `itemCostId` (`FOR UPDATE`), cek `stock >= qty`, ambil `buyPrice` &
   `sellPrice` dari baris itu (ganti dari cara lama yang baca
   `products.sell_price`).
2. `hargaEfektif = sellPrice - (item.discount ?? 0)`.
3. Kalau ada baris dengan `hargaEfektif <= buyPrice` dan
   `confirmOverride` bukan `true` → **belum commit apapun**, balikin 200
   berisi daftar baris yang kena warning + selisihnya.
4. Kalau `confirmOverride: true` (atau gak ada baris yang kena warning) →
   lanjut commit seperti biasa: stok batch kepotong, `buyPriceSnapshot`
   diisi dari batch yang dipakai, `discount` per-item kesimpen,
   `AuditLog` mencatat override kalau dipakai.

`lineTotal` = `qty * unitPrice - discount`. Diskon level-transaksi (yang
udah ada) tetap dihitung di atas total `lineTotal` semua baris, sama
seperti sekarang — dua jenis diskon numpuk, bukan saling gantiin.

## 8. Tampilan Frontend (POS)

- Listing produk: harga ditampilin sebagai range (lihat §4.9), stok = SUM
  semua batch aktif.
- Klik produk yang punya >1 batch aktif → dialog/popup nampilin list
  batch (supplier, harga jual, sisa stok) → kasir pilih satu → masuk
  keranjang bawa `itemCostId` itu.
- Produk dengan cuma 1 batch aktif → langsung masuk keranjang, gak ada
  popup.
- Kalau checkout balikin warning (langkah 7.3): tampilkan dialog
  konfirmasi berisi baris mana yang di bawah modal + selisihnya → kasir
  klik lanjut → checkout dikirim ulang dengan `confirmOverride: true`.
- Pola yang sama (dialog konfirmasi) dipakai juga di form stock-in kalau
  backend balikin `requiresConfirmation: true`.

## 9. Dampak ke Laporan

`ReportsService.profitLoss()` tetap akurat untuk transaksi baru karena
`buyPriceSnapshot` di `InvoiceItem` direkam pas checkout (independen dari
berapa banyak batch yang ada). Yang berubah: fallback buat baris invoice
LAMA (`buyPriceSnapshot IS NULL`, dari sebelum kolom ini ada) — sebelumnya
baca `item_costs` TERKINI (1 nilai), sekarang diganti jadi **rata-rata
`buyPrice` dari semua batch yang lagi aktif** untuk `refId` itu (estimasi
kasar, cuma dipakai buat data lama yang emang udah gak presisi dari awal).

## 10. Migrasi Data Lama

Saat migrasi dijalankan:
1. Untuk tiap `Product` yang punya `sellPrice`/`stock` & baris
   `item_costs` lama: buat 1 baris `item_costs` baru ("batch awal") pakai
   `buyPrice` lama, `sellPrice` = `products.sell_price` lama, `stock` =
   `products.stock` lama, `supplierName = null`.
2. Drop kolom `sellPrice`/`stock` dari tabel `products`.
3. Ubah PK `item_costs` dari `[kind, refId]` jadi `id` (`kind`+`refId`
   jadi kolom biasa + index).
4. `TransactionItem`/`InvoiceItem`: tambah kolom `discount DEFAULT 0`
   (baris lama otomatis kebaca sebagai 0, gak ada perubahan lineTotal).
5. `StockMovement`: tambah kolom `itemCostId` nullable (baris lama tetap
   null, gak ada cara nebak batch mana yang kepake retroaktif — diterima
   sebagai limitasi histori lama).

## 11. Edge Case

- Rebutan batch (2 kasir checkout bareng): tetap aman lewat `FOR UPDATE`,
  pola sama kayak sekarang.
- Produk belum pernah di-stock-in (belum ada batch): gak muncul/gak bisa
  ditambah di POS, katalog tampil "stok habis".
- 1 keranjang isi 2 baris dari produk sama tapi beda batch: diperbolehkan,
  2 baris terpisah dengan `itemCostId` masing-masing.

## 12. Testing

- Unit test kalkulasi warning (stock-in & checkout), termasuk kasus tepat
  breakeven (`hargaEfektif == buyPrice`).
- Unit test `lockAndDeduct` versi batch (lock baris `item_costs` yang
  benar, bukan tabel `products`).
- Test migrasi: data lama ke-convert jadi 1 batch tanpa kehilangan angka.
- Test alur 2-langkah checkout: submit → dapet warning → confirm →
  sukses; dan submit yang gak kena warning → langsung sukses tanpa perlu
  confirm.
- Test permission: role selain admin/kasir gak bisa kirim
  `confirmOverride: true` (kalau dicoba, tetap diblokir di guard/role
  check yang udah ada).
