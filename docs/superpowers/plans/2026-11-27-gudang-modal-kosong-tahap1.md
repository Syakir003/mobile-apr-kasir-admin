# Modal Boleh Kosong (Tahap 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barang masuk boleh tanpa harga modal, dan admin bisa mengisi atau mengoreksinya belakangan di web.

**Architecture:** `item_costs.buy_price` menjadi nullable; semua pembaca modal melewati `NULL` lewat satu util. Pengisian dan koreksi ada di service baru `StockCostService` yang sekaligus menghitung ulang `invoice_items.buy_price_snapshot` dalam satu transaksi.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), Jest 30; Next.js di `Nest/epos-frontend-web` (baca `AGENTS.md` di sana sebelum menulis kode).

**Spec:** `docs/superpowers/specs/2026-11-27-gudang-terima-barang-design.md` (hanya Tahap 1)

Path backend relatif ke `Nest/epos-backend`, path web relatif ke `Nest/epos-frontend-web`.

## Global Constraints

- Harga kosong **tidak pernah** dihitung sebagai Rp0. Harga 0 yang diisi sengaja tetap 0, bukan "belum diisi".
- Penjualan tidak pernah tertahan karena modal kosong.
- Perubahan backend bersifat tambahan: klien lama yang mengirim `buyPrice` berperilaku sama.
- Endpoint modal hanya untuk `admin`. Harga modal tidak boleh terbaca peran lain.
- Outdoor milik paket selalu modal 0 dan tidak bisa diberi harga.
- Teks antarmuka berbahasa Indonesia; label harga kosong persis `Belum diisi`.
- Urutan kunci baris sparepart: `spareparts` dulu, baru `item_costs` (hindari deadlock).
- Migrasi dan tes manual hanya ke database lokal. Deploy VPS dilakukan user.
- Commit tanpa trailer `Co-Authored-By`. `git add` hanya berkas milik tugas itu (ada perubahan mobile lain yang belum di-commit).

## Review Focus

- Admin mengisi harga saat checkout barang yang sama sedang berjalan: invoice itu tetap berakhir dengan modal yang benar (Task 4, kunci baris).
- Harga 0 diisi admin: batch keluar dari daftar belum diisi dan invoice mencatat 0 (Task 4).
- Simpan ditekan dua kali dengan angka sama: hasil sama, tidak ada galat (Task 4).
- Daftar batch campuran dari dua barang berbeda dalam satu permintaan: ditolak, tidak ada yang berubah (Task 4).
- Semua batch suatu AC kosong saat checkout: penjualan jalan, `buy_price_snapshot` NULL (Task 1).

---

### Task 1: Modal nullable dan pembaca yang tahan NULL

**Files:**
- Create: `prisma/migrations/20261128000000_nullable_buy_price/migration.sql`, `src/common/cost.util.ts`, `src/common/cost.util.spec.ts`
- Modify: `prisma/schema.prisma` (model `ItemCost`: `buyPrice Decimal?`), `src/common/services/stock-locking.service.ts`, `src/pos/pos.service.ts`, `src/common/exceptions/confirmation-required.exception.ts`
- Test: `src/common/services/stock-locking.service.spec.ts`

**Interfaces:**
- Produces: `toCost(value: unknown): number | null` (`null`/`undefined` jadi `null`, selain itu `Number`); `maxKnownCost(values: unknown[]): number | null` (NULL dilewati; tidak ada yang terisi jadi `null`). `SingleUnitWarning.packageBuyPrice: number | null`.

- [ ] **Step 1: Tulis tes gagal**

```ts
// cost.util.spec.ts
it('toCost membedakan kosong dari nol', () => {
  expect(toCost(null)).toBeNull();
  expect(toCost(undefined)).toBeNull();
  expect(toCost('0')).toBe(0);
  expect(toCost('2900000.00')).toBe(2900000);
});
it('maxKnownCost melewati yang kosong', () => {
  expect(maxKnownCost([null, '100', '300', null])).toBe(300);
  expect(maxKnownCost([null, null])).toBeNull();
  expect(maxKnownCost([])).toBeNull();
});

// stock-locking.service.spec.ts, pola fakeTxSequence yang sudah ada
it('product: batch tanpa modal tidak dihitung 0', ...)      // batch {null}, {'3100000'} -> result.buyPrice === 3100000
it('product: semua batch tanpa modal tetap bisa dijual', ...) // batch {null} -> buyPrice === null, reservedUnitIds terisi
it('sparepart gulungan: semua gulungan tanpa modal', ...)     // -> buyPrice === null
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npx jest cost.util stock-locking` → FAIL
- [ ] **Step 3: Migrasi dan skema**

```sql
ALTER TABLE "item_costs" ALTER COLUMN "buy_price" DROP NOT NULL;
```
Lalu `npx prisma generate`.

- [ ] **Step 4: Implementasi util, pakai di `stock-locking.service.ts`** (cabang product dan sparepart gulungan) **dan di `pos.service.ts`** pada: modal komponen paket instalasi, modal sparepart biasa, modal paket jual satuan (`packageCostByIndex` jadi `Map<number, number | null>`).
- [ ] **Step 5: Periksa** — `grep -nE "Number\((cost|batch|modalRows).*[Bb]uy_?[Pp]rice" src/pos/pos.service.ts src/common/services/stock-locking.service.ts` → tidak ada hasil. `npx tsc --noEmit && npx jest` → lulus.
- [ ] **Step 6: Commit** — `feat(stok): harga modal boleh kosong dan tidak dihitung nol`

### Task 2: Barang masuk tanpa harga

**Files:**
- Modify: `src/stock/dto/stock-in.dto.ts`, `src/stock/stock.service.ts` (`stockIn`), `src/stock/stock.controller.ts`
- Test: `src/stock/dto/stock-in.dto.spec.ts`, create `src/stock/stock.service.stock-in.spec.ts`

**Interfaces:**
- Produces: `StockInDto.buyPrice?: number`; hasil `stockIn` berstatus `ok` membawa `costPending: boolean` (true hanya bila ada baris yang benar-benar disimpan `NULL`).

- [ ] **Step 1: Tulis tes gagal** (fake `prisma.$transaction` dan `tx`, `counters.nextSeq` palsu)

```ts
it('DTO menerima barang masuk tanpa buyPrice', ...)           // errors.length === 0
it('DTO tetap menolak buyPrice negatif', ...)
it('AC tunggal tanpa harga: batch NULL, tanpa konfirmasi', ...) // itemCost.create data.buyPrice null; status 'ok'; costPending true
it('paket tanpa harga: Indoor NULL, Outdoor 0', ...)
it('Outdoor milik paket diterima sendiri: 0, costPending false', ...)
it('sparepart gulungan tanpa harga: tiap gulungan NULL', ...)
it('sparepart biasa yang sudah punya harga: itemCost tidak di-update, costPending false', ...) // itemCost.update tidak dipanggil
it('sparepart biasa belum punya harga: baris dibuat NULL, costPending true', ...)
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npx jest stock-in`
- [ ] **Step 3: Implementasi.** `buyPrice` jadi `@IsOptional()`. Tanpa harga: lewati `checkBelowCost`. Sparepart biasa yang sudah punya baris: jangan panggil `update` (supaya `updatedAt` tidak bergeser). Audit log menyimpan `buyPrice: null`.
- [ ] **Step 4: Notifikasi** di controller, hanya bila `status === 'ok' && costPending && user.role !== 'admin'`: `notifyRoles(['admin'], { title: 'Modal Belum Diisi', body: '<nama barang> sudah diterima tanpa harga modal.', type: 'modal_kosong' })`.
- [ ] **Step 5: `npx tsc --noEmit && npx jest`** → lulus
- [ ] **Step 6: Commit** — `feat(stok): barang masuk boleh tanpa harga modal`

### Task 3: Laporan menandai modal belum diisi

**Files:**
- Modify: `src/reports/reports.service.ts`, `src/reports/stock-report-row.util.ts`
- Test: `src/reports/stock-report-row.util.spec.ts`, `src/reports/reports.service.technician.spec.ts` sebagai contoh pola; create `src/reports/reports.service.cost-pending.spec.ts`

**Interfaces:**
- Produces: `StockReportRow.modalBelumDiisi: boolean`; tiap item `profitLoss` membawa `modalBelumDiisi: boolean`.

- [ ] **Step 1: Tulis tes gagal**

```ts
it('baris stok ditandai bila barangnya punya modal kosong', ...)     // modalBelumDiisi === true
it('barang tanpa modal kosong tidak ditandai', ...)
it('profitLoss: catatan menyebut "modal belum diisi"', ...)           // toContain('belum diisi'), modalBelumDiisi true
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npx jest reports stock-report`
- [ ] **Step 3: Implementasi.** Satu method privat `refsWithPendingCost(): Promise<Set<string>>` (kunci `kind:refId` dari `item_costs` ber-`buy_price IS NULL`), dipakai kedua laporan. Catatan yang ditambahkan: `Ada modal belum diisi, angka belum final`. Baris `invoice_items` bertipe `installation_package_item` memakai kunci `sparepart:refId`.
- [ ] **Step 4: `npx tsc --noEmit && npx jest`** → lulus
- [ ] **Step 5: Commit** — `feat(laporan): tandai modal yang belum diisi`

### Task 4: Daftar modal, isi/koreksi, hitung ulang invoice

**Files:**
- Create: `src/stock/stock-cost.service.ts`, `src/stock/dto/set-cost.dto.ts`, `src/stock/stock-cost.service.spec.ts`
- Modify: `src/stock/stock.controller.ts`, `src/stock/stock.module.ts`

**Interfaces:**
- Consumes: `toCost`, `maxKnownCost` (Task 1).
- Produces, semua `@Roles('admin')` di level method:
  - `GET /stock/costs?filter=pending|all&refId=` → `CostRow[]`, terbaru dulu, maks 200:
    `{ itemCostIds: string[]; kind: 'product'|'sparepart'; refId: string; name: string; unit: string; buyPrice: number|null; sellPrice: number; qtyReceived: number|null; supplierName: string|null; createdAt: Date; createdByName: string|null }`
  - `PUT /stock/batches/:itemCostId/cost` body `SetCostDto { buyPrice: number (>=0); supplierName?: string; alsoItemCostIds?: string[]; confirmOverride?: boolean }` → `{ status: 'ok'; updatedInvoiceNumbers: string[] } | { status: 'confirm_required'; warnings }`

`GET /stock/costs` menggantikan `GET /stock/pending-cost` di spec: koreksi juga harus bisa untuk batch yang sudah habis terjual dan sparepart biasa, yang tidak tampil di halaman detail.

Aturan daftar: Outdoor milik paket (produk yang menjadi target `pairedProductId`) tidak muncul. Gulungan dengan `refId`, pemasok, pencatat, dan menit penerimaan yang sama digabung jadi satu baris. `qtyReceived`, `createdByName` dari mutasi `barang_masuk` ber-`itemCostId` itu; sparepart biasa `null`.

Aturan hitung ulang (spec, "Menghitung ulang invoice"):
1. Kunci baris: `spareparts` (bila sparepart) lalu `item_costs`, `FOR UPDATE`.
2. Barang ber-mutasi per batch: ambil `transactionId` dari mutasi `penjualan`/`pemakaian_instalasi` ber-`itemCostId` target. Per transaksi: kumpulkan semua `itemCostId` yang diambil untuk `refId` itu, `maxKnownCost` harganya, tulis ke baris invoice transaksi itu dengan `refId` sama, `costUnallocated = false`; `kind` `product`, atau `sparepart`/`installation_package_item`. `saleKind === 'utuh'` dikali `packSize` dan dibulatkan ke rupiah.
3. Sparepart biasa: baris invoice sparepart itu yang `createdAt` invoice-nya >= `updatedAt` lama baris `item_costs` dan snapshot-nya `NULL` atau sama dengan harga lama (setelah dikali `packSize` bila utuh).

- [ ] **Step 1: Tulis tes gagal** (fake db in-memory untuk `itemCost`, `stockMovement`, `invoice`, `invoiceItem`, `product`, `sparepart`, `auditLog`)

```ts
it('mengisi harga memperbarui invoice AC yang mengambil batch itu', ...)   // snapshot 3000000; nomor invoice dikembalikan
it('invoice yang mengambil dua batch memakai harga tertinggi', ...)
it('koreksi ke harga lebih rendah menurunkan snapshot', ...)               // 35000000 -> 3500000
it('invoice yang tidak mengambil batch itu tidak berubah', ...)
it('jual satuan dari paket (costUnallocated) tidak berubah', ...)
it('jual utuh dikali packSize dan dibulatkan', ...)
it('komponen paket instalasi ikut diperbarui', ...)
it('sparepart biasa: hanya NULL atau harga lama sejak updatedAt lama', ...)
it('harga 0 diterima dan dicatat 0, bukan NULL', ...)
it('dipanggil dua kali dengan angka sama: hasil sama', ...)
it('modal >= harga jual tanpa confirmOverride: confirm_required, tak ada perubahan', ...)
it('alsoItemCostIds beda refId: BadRequest, tak ada perubahan', ...)
it('batch Outdoor milik paket ditolak', ...)
it('mengunci baris sebelum membaca invoice', ...)                          // urutan panggilan: FOR UPDATE lebih dulu
it('audit log mencatat harga lama, baru, dan invoice', ...)                // action 'stock.set_cost'
it('daftar pending: gulungan satu penerimaan jadi satu baris', ...)
it('kedua endpoint hanya admin', ...)                                      // Reflect.getMetadata(ROLES_KEY, handler) = ['admin']
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `npx jest stock-cost`
- [ ] **Step 3: Implementasi** `StockCostService.list(query)` dan `setCost(itemCostId, dto, actorId)`; seluruh `setCost` dalam satu `prisma.$transaction`.
- [ ] **Step 4: `npx tsc --noEmit && npx jest`** → lulus
- [ ] **Step 5: Uji di database lokal.** Pastikan `DATABASE_URL` menunjuk localhost, `npx prisma migrate deploy`, `npm run start:dev`. Barang masuk tanpa harga → checkout → `PUT .../cost` → `GET /invoices/:id` sebagai admin menunjukkan snapshot baru; token gudang ke `GET /stock/costs` → 403.
- [ ] **Step 6: Commit** — `feat(stok): admin bisa mengisi dan mengoreksi harga modal`

### Task 5: Web, halaman Modal Barang

**Files:**
- Create: `src/app/(dashboard)/stock/modal/page.tsx`, `src/app/(dashboard)/stock/modal/cost-dialog.tsx`
- Modify: `src/proxy.ts` (aturan `{ prefix: '/stock/modal', roles: ['admin'] }` **di atas** `/stock`), `src/app/(dashboard)/_components/nav-config.ts` (menu admin "Stok & Gudang": `Modal Barang`)

**Interfaces:**
- Consumes: dua endpoint Task 4.
- Produces: `/stock/modal?refId=<id>&tab=semua` (dipakai Task 6).

Tab `Belum Diisi` (bawaan) dan `Semua Batch`. Dialog isi/ubah: pemasok, harga. Bila mengubah harga yang sudah ada, tampilkan harga lama, harga baru, dan teks `Laporan penjualan lama ikut berubah.` sebelum simpan. `confirm_required` ditampilkan seperti di `product-detail-client.tsx`. Sesudah simpan sebutkan nomor invoice yang diperbarui.

- [ ] **Step 1: Implementasi** mengikuti pola `stock/opname/` (Tabs, `apiClient`, react-query).
- [ ] **Step 2: Periksa** — `npx tsc --noEmit && npm run lint && npm run build` → tanpa galat (web tidak punya test runner).
- [ ] **Step 3: Uji di browser, server lokal.** Admin: isi, koreksi, konfirmasi. Gudang membuka `/stock/modal` → dialihkan.
- [ ] **Step 4: Commit** — `feat(web): halaman modal barang untuk admin`

### Task 6: Web, tampilkan "Belum diisi" di tempat lain

**Files (Modify), di `src/app/(dashboard)/`:**
- `master/produk/[id]/product-detail-client.tsx`: harga `null` → `Belum diisi`; tombol `Ubah modal` per batch (admin) ke halaman Task 5.
- `master/sparepart/[id]/sparepart-detail-client.tsx`: sama; sparepart biasa mendapat satu tombol `Ubah modal` di halaman detail.
- `pos/page.tsx`: `packageBuyPrice: number | null` → `Belum diisi`.
- `laporan/page.tsx`, `laporan/stok/print/stok-print-client.tsx`: baris ber-`modalBelumDiisi` diberi tanda `*` dan satu keterangan `* Ada modal belum diisi, angka belum final.`

- [ ] **Step 1: Implementasi.**
- [ ] **Step 2: Periksa** — `grep -rn "formatRupiah(.*[bB]uyPrice" "src/app/(dashboard)"` dan pastikan tiap hasil menangani `null`; `npx tsc --noEmit && npm run lint && npm run build`.
- [ ] **Step 3: Uji di browser** dengan satu batch kosong: detail produk, peringatan POS jual satuan, laporan.
- [ ] **Step 4: Commit** — `feat(web): tandai harga modal yang belum diisi`

## Sesudah tahap 1

Deploy oleh user: backup database, `npx prisma migrate deploy`, build backend dan web. Selama tahap 3 belum jadi, form barang masuk web masih meminta harga, termasuk dari gudang.
