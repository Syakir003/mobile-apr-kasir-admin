# Fase 4 — POS & Pembayaran: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keranjang POS kasir/admin (AC/sparepart/jasa), `checkoutTransaction` atomik (member otomatis by HP, stok, invoice bernomor urut, unit AC + barcode + order + job pemasangan), `recordPayment` manual (tunai/transfer/QRIS/e-wallet) dengan status invoice, riwayat invoice + struk PDF.

**Arsitektur:** Semua penulisan uang & stok lewat Cloud Functions callable (ADR-2); client hanya membangun payload + membaca stream Firestore. Harga SELALU diambil server dari master (client tidak mengirim harga). Item transaksi di-snapshot ke dalam dokumen invoice (struk self-contained) selain subcollection `transactions/{id}/items`.

**Tech Stack:** Flutter + Riverpod + go_router (pola fase 1–3), Cloud Functions TypeScript v2 `onCall` + vitest, paket `pdf`/`printing` yang sudah ada.

**Acuan:** `Dokumen_Fitur_EPOS_AC_Mobile_Realtime.docx` bab 5.9 (Transaksi E-POS), 5.10 (Pembayaran Manual), 5.16 (Invoice/Struk), 5.17 (Stok), 6.1/6.2 (flow), 8.5 (rule pembayaran), + spec `2026-07-03-epos-ac-design.md` §5.

## Global Constraints

- **TIDAK ada dependensi pubspec/npm baru.** Semua paket sudah tersedia.
- Uang rupiah `int`; qty sparepart boleh pecahan (`num`); `lineTotal = round(qty * unitPrice)`.
- Field Firestore koleksi baru **snake_case** (pola `members`/`member_ac_units`).
- Semua teks UI bahasa Indonesia; commit message bahasa Indonesia pola fase 1–3.
- Rounding pajak: `taxBase = subtotal - discount`; `taxAmount = round(taxBase * taxPercent / 100)`; `grandTotal = taxBase + taxAmount + transportFee`. Transport TIDAK kena pajak. Dart & TS harus identik.
- `flutter analyze` bersih, `flutter test` lulus, `npm test` + `npm run build` functions lulus sebelum tiap commit.

## Keputusan desain (disetujui user 2026-07-12)

1. **Checkout full sesuai spec:** item AC bertanda "dengan pemasangan" → buat `member_ac_units` (+barcode) + `service_orders` + `technician_jobs` sekaligus, walau layar order/job baru dibangun Fase 5.
2. **Diskon (Rp) + pajak (%) + transport level transaksi saja**, tidak per item.
3. **Bukti pembayaran ditunda:** field `proof_url` disiapkan (null), UI upload menyusul Fase 5+.
4. Turunan: kategori jasa berupa teks bebas → pemasangan ditandai **eksplisit oleh kasir** per baris AC (toggle + lokasi ruangan + dropdown teknisi opsional). Teknisi dipilih → job `assigned`; kosong → `menunggu_penugasan`.
5. Status invoice Fase 4: `belum_dibayar` → `dp` (bayar sebagian) → `lunas`. `kurang_bayar`/`refund`/`batal` masuk enum tapi baru dipakai fase 6+.
6. `recordPayment` menolak `amount > sisa` (kembalian tunai dihitung di client, yang dicatat = nominal pas).

## Kontrak data Firestore (ditulis HANYA oleh Functions)

- `transactions/{id}`: member_id, customer_name, customer_phone, subtotal, discount, tax_percent, tax_amount, transport_fee, grand_total, notes, created_by, created_at. Subcollection `items/{id}`: kind ('product'|'sparepart'|'service'), ref_id, name, unit, qty, unit_price, line_total.
- `invoices/{id}`: number (`INV-YYYYMMDD-XXXX`), transaction_id, member_id, customer_name, customer_phone, items[] (snapshot bentuk sama dgn di atas), subtotal, discount, tax_percent, tax_amount, transport_fee, grand_total, total_paid (mulai 0), status, notes, created_by, created_at.
- `manual_payments/{id}`: invoice_id, method ('tunai'|'transfer'|'qris'|'ewallet'), amount, note, proof_url (null), created_by, created_at.
- `stock_movements/{id}`: item_kind ('product'|'sparepart'), ref_id, name, qty_change (negatif), reason ('penjualan'), transaction_id, created_by, created_at.
- `service_orders/{id}`: member_id, transaction_id, invoice_id, type ('pemasangan'), status ('terjadwal'), units[] ({unit_id, status:'menunggu_pemasangan'}), created_by, created_at. **Satu order per checkout**, semua unit pemasangan masuk `units[]`.
- `technician_jobs/{id}`: order_id, member_id, unit_id, technician_id (string|null), type ('pemasangan'), status ('assigned' bila technician_id ada, selain itu 'menunggu_penugasan'), scheduled_date (null), created_by, created_at. **Satu job per unit.**
- `counters/invoice_YYYYMMDD` {seq} — pola sama `counters/acunit_YYYYMMDD` (di-reuse untuk barcode saat checkout).

---

### Task A: Util murni functions (TDD vitest)

**Files:**
- Create: `functions/src/pos/phone.ts`, `functions/src/pos/phone.test.ts`
- Create: `functions/src/pos/totals.ts`, `functions/src/pos/totals.test.ts`
- Create: `functions/src/pos/invoice.ts`, `functions/src/pos/invoice.test.ts`

**Interfaces (Produces):**
- `normalizePhone(raw: string): string` — port PERSIS dari `app/lib/core/utils/phone.dart` (buang `[\s\-.()]`; `+62`→tetap; `628`→`+`; `08`→`+62`+potong 0; `8`→`+62`+; selain itu apa adanya).
- `computeTotals(lines: {qty: number; unitPrice: number}[], discount: number, taxPercent: number, transportFee: number): {subtotal: number; taxAmount: number; grandTotal: number}` — lineTotal dibulatkan per baris; rumus di Global Constraints.
- `formatInvoiceNumber(date: Date, seq: number): string` → `INV-YYYYMMDD-XXXX` (import `dateKey` dari `../units/barcode`).
- `computeInvoiceStatus(grandTotal: number, totalPaid: number): 'belum_dibayar' | 'dp' | 'lunas'` — `totalPaid <= 0 && grandTotal > 0` → belum_dibayar; `< grandTotal` → dp; `>=` → lunas (termasuk grandTotal 0).

- [ ] **Step A1:** Tulis test dulu — `phone.test.ts` (4 kasus, sama dgn `phone_test.dart`: `0812-3456-7890`→`+6281234567890`, `6281234567890`→`+6281234567890`, `+62 812-3456-7890`→`+6281234567890`, `021 555 1234`→`0215551234` tetap tanpa +62); `totals.test.ts` (3 kasus: tanpa diskon/pajak; diskon+pajak 11%+transport — verifikasi transport tak kena pajak; qty pecahan 2.5 m × 15000 = 37500); `invoice.test.ts` (seq 1 → `INV-20260712-0001`; pad seq 1234; status: (100000,0)→belum_dibayar, (100000,40000)→dp, (100000,100000)→lunas, (0,0)→lunas). Jalankan `npm test` → test baru FAIL.
- [ ] **Step A2:** Implementasi ketiga file sampai `npm test` lulus (6 lama + ~11 baru).
- [ ] **Step A3:** `npm run build` lulus. Commit: `feat(functions): util pos — telepon, total, nomor & status invoice`

### Task B: `checkoutTransaction` (callable)

**Files:**
- Create: `functions/src/pos/validation.ts`, `functions/src/pos/validation.test.ts`
- Create: `functions/src/pos/checkout.ts`
- Modify: `functions/src/index.ts` (tambah `export { checkoutTransaction } from "./pos/checkout";`)

**Interfaces:**
- Consumes: `normalizePhone`, `computeTotals`, `formatInvoiceNumber` (Task A); `dateKey`, `formatBarcode` dari `../units/barcode`.
- Produces — payload callable `checkoutTransaction`:
```ts
export type CheckoutInput = {
  customer: { name: string; phone: string; address?: string };
  items: { kind: "product" | "sparepart" | "service"; refId: string; qty: number }[];
  discount?: number;      // Rp >= 0
  taxPercent?: number;    // 0..100
  transportFee?: number;  // Rp >= 0
  notes?: string;
  installations?: { itemIndex: number; roomLocation?: string; technicianId?: string }[];
};
```
  Return `{ invoiceId, invoiceNumber, memberId, transactionId }`.
- `validateCheckoutInput(input: unknown): {ok:true; value:CheckoutInput} | {ok:false; error:string}` (pola `validateManageUserInput`): name & phone wajib; items minimal 1, kind valid, refId string, qty > 0; discount/taxPercent/transportFee dalam rentang; tiap installations.itemIndex menunjuk item kind 'product'; jumlah entri installations per itemIndex ≤ qty item tsb.

- [ ] **Step B1:** `validation.test.ts` dulu (5 kasus: valid lengkap; tanpa items → error; qty 0 → error; itemIndex menunjuk jasa → error; installations 3 entri utk qty 2 → error). `npm test` FAIL → implement `validation.ts` → PASS.
- [ ] **Step B2:** Implement `checkout.ts` — `onCall`, role admin/kasir (pola `generateAcUnitBarcode`). Satu `db.runTransaction`; **SEMUA read sebelum write** (batasan Firestore transaction):
  1. Read: query member by `phone` ternormalisasi (limit 1); semua doc master per item (tolak jika tidak ada / `active == false` / stok kurang — `HttpsError failed-precondition` menyebut nama item); counter `invoice_YYYYMMDD`; counter `acunit_YYYYMMDD` bila ada installations; tiap `technicianId` → doc `users` harus role teknisi & active (invalid-argument bila bukan).
  2. Harga server: product/sparepart pakai `sellPrice`, service pakai `basePrice`; name/unit ikut master (product unit 'unit', service unit 'jasa'). Hitung `computeTotals`.
  3. Write: member baru (`member_since: FieldValue.serverTimestamp()`, `total_ac_units` = jumlah installations, phone ternormalisasi, `customer_type:'lainnya'`, `active:true`) ATAU update member lama (`total_ac_units: FieldValue.increment(n)` bila n>0); `transactions` + subcollection `items`; `stock_movements` + decrement `stock` per product/sparepart; `invoices` (status 'belum_dibayar', total_paid 0, items snapshot); per installation: `member_ac_units` (brand=product.brand, model=product.type, pk=product.pk, room_location dari input, barcode_value dari `formatBarcode(now, seq++)`, status 'menunggu_pemasangan' — field snake_case pola `AcUnit.toMap`); satu `service_orders` + `technician_jobs` per unit; `audit_logs` {actor_uid, action:'pos.checkout', target: invoiceId, detail:{number, grand_total}, at}.
- [ ] **Step B3:** Export di `index.ts`; `npm test` (semua lulus) dan `npm run build` lulus. Commit: `feat(functions): checkoutTransaction atomik dengan member otomatis & job pemasangan`

### Task C: `recordPayment` (callable)

**Files:**
- Modify: `functions/src/pos/validation.ts` + `validation.test.ts` (tambah `RecordPaymentInput` + `validateRecordPaymentInput`)
- Create: `functions/src/pos/recordPayment.ts`
- Modify: `functions/src/index.ts`

**Interfaces (Produces):**
```ts
export type RecordPaymentInput = {
  invoiceId: string;
  method: "tunai" | "transfer" | "qris" | "ewallet";
  amount: number; // Rp > 0, integer
  note?: string;
};
```
Return `{ status, totalPaid }`.

- [ ] **Step C1:** Test validasi dulu (3 kasus: valid; amount 0 → error; method 'kartu' → error). FAIL → implement → PASS.
- [ ] **Step C2:** Implement `recordPayment.ts` — role admin/kasir; transaction: read invoice (tidak ada → not-found; status 'batal'/'refund' → failed-precondition; `amount > grand_total - total_paid` → failed-precondition 'Melebihi sisa tagihan'); write `manual_payments` {…, proof_url: null, created_by, created_at}; update invoice `total_paid` + `status` via `computeInvoiceStatus`; `audit_logs` action 'pos.payment'.
- [ ] **Step C3:** Export; `npm test` + `npm run build` lulus. Commit: `feat(functions): recordPayment manual & status invoice`

### Task D: Model + repositori + providers Dart

**Files:**
- Create: `app/lib/data/models/invoice.dart`, `app/lib/data/models/manual_payment.dart`
- Create: `app/lib/data/repositories/invoice_repository.dart`
- Create: `app/lib/features/transactions/invoice_providers.dart`
- Test: `app/test/data/invoice_payment_test.dart`, `app/test/support/fake_invoice_repository.dart`

**Interfaces (Produces):**
- `InvoiceStatus` enum (pola `AcUnitStatus`): belumDibayar('belum_dibayar','Belum Dibayar'), dp('dp','DP'), kurangBayar('kurang_bayar','Kurang Bayar'), lunas('lunas','Lunas'), refund('refund','Refund'), batal('batal','Batal'); `fromValue` default belumDibayar.
- `PaymentMethod` enum: tunai('tunai','Tunai'), transfer('transfer','Transfer Bank'), qris('qris','QRIS Manual'), ewallet('ewallet','E-Wallet Manual').
- `InvoiceItem` {kind, refId, name, unit, qty (num), unitPrice (int), lineTotal (int)} — fromMap/toMap snake_case.
- `Invoice` {id, number, transactionId, memberId, customerName, customerPhone, items (List<InvoiceItem>), subtotal, discount, taxPercent (double), taxAmount, transportFee, grandTotal, totalPaid, status, notes?, createdAt (DateTime? via helper `_toDate` pola `Member`)} + `sisa` getter (`grandTotal - totalPaid`).
- `ManualPayment` {id, invoiceId, method, amount, note?, proofUrl?, createdBy, createdAt (DateTime?)}.
- `abstract interface class InvoiceRepository { Stream<List<Invoice>> watchAll(); Stream<Invoice?> watchById(String id); Stream<List<ManualPayment>> watchPayments(String invoiceId); }` + `FirestoreInvoiceRepository` (watchAll: orderBy 'created_at' desc limit 100; watchPayments: where invoice_id, orderBy created_at).
- Providers di `invoice_providers.dart`: `invoiceRepositoryProvider`, `invoicesStreamProvider`, `invoiceProvider` (family by id), `invoicePaymentsProvider` (family), `recordPaymentCallerProvider = Provider<Future<void> Function(Map<String, dynamic> payload)>` (callable 'recordPayment', pola `acUnitBarcodeGeneratorProvider`).
- `FakeInvoiceRepository` (pola `FakeAcUnitRepository`: broadcast controller + `scheduleMicrotask` seed; simpan seed invoices & payments).

- [ ] **Step D1:** Test roundtrip dulu di `invoice_payment_test.dart` (4 test: Invoice fromMap/toMap lengkap termasuk items[]; Invoice default status belumDibayar & totalPaid 0 & `sisa`; ManualPayment roundtrip; enum values/labels + fromValue fallback). Tanpa import cloud_firestore di test (tanggal via `Object?`). `flutter test` FAIL → implement model → PASS.
- [ ] **Step D2:** Implement repository + providers + fake; test fake emit (1 test di file yang sama: watchPayments hanya emit milik invoice tsb). `flutter analyze` bersih.
- [ ] **Step D3:** Commit: `feat(app): model invoice & pembayaran + repositori/providers`

### Task E: Keranjang POS + checkout UI

**Files:**
- Create: `app/lib/features/pos/cart_state.dart` (murni, tanpa Flutter import)
- Create: `app/lib/features/pos/pos_providers.dart`
- Create: `app/lib/features/pos/item_picker_sheet.dart`
- Create: `app/lib/features/pos/pos_screen.dart`
- Create: `app/lib/features/pos/checkout_screen.dart`
- Test: `app/test/features/pos/cart_state_test.dart`, `app/test/features/pos/pos_screen_test.dart`, `app/test/features/pos/checkout_screen_test.dart`

**Interfaces:**
- Consumes: `productListProvider`/`sparepartListProvider`/`serviceListProvider` (master_providers), `firestoreProvider`, model master; `normalizePhone` Dart.
- Produces (`cart_state.dart`):
```dart
enum CartItemKind { product, sparepart, service }
class CartLine { // immutable + copyWith
  kind, refId, name, unit, unitPrice(int), qty(num),
  withInstallation(bool=false), roomLocation(String=''), technicianId(String?)
}
class Cart { // immutable + copyWith
  lines(List<CartLine>), discount(int=0), taxPercent(double=0), transportFee(int=0),
  customerName(''), customerPhone(''), customerAddress(''), notes('')
}
({int subtotal, int taxAmount, int grandTotal}) computeCartTotals(Cart cart); // rumus = server
Map<String, dynamic> buildCheckoutPayload(Cart cart); // bentuk CheckoutInput; phone dinormalisasi;
  // installations: satu entri per unit qty utk baris product withInstallation (itemIndex = posisi baris)
class CartNotifier extends Notifier<Cart> { addLine(CartLine), setQty(int index, num qty),
  removeAt(int index), setInstallation(int index, {bool? enabled, String? roomLocation, String? technicianId}),
  setDiscount/setTaxPercent/setTransportFee/setCustomer/setNotes, clear() }
```
- `pos_providers.dart`: `cartProvider = NotifierProvider<CartNotifier, Cart>`; `checkoutCallerProvider = Provider<Future<({String invoiceId, String invoiceNumber})> Function(Map<String, dynamic>)>` (callable 'checkoutTransaction'); `techniciansProvider = StreamProvider<List<({String uid, String name})>>` — query `users` where role=='teknisi', active==true, map `display_name`.
- `addLine` merge: kind+refId sama → qty += (kecuali product withInstallation, tetap merge qty; toggle per baris).

- [ ] **Step E1:** `cart_state_test.dart` dulu (5 test: totals mirror 3 kasus server Task A; addLine merge qty; buildCheckoutPayload — phone ternormalisasi, installations qty 2 → 2 entri itemIndex sama, jasa tanpa installations). `flutter test` FAIL → implement `cart_state.dart` → PASS.
- [ ] **Step E2:** `item_picker_sheet.dart` — bottom sheet `DefaultTabController` 3 tab (Produk/Sparepart/Jasa) + `TextField` filter nama; tap item → `cartProvider.addLine` (product: unitPrice=sellPrice, unit='unit'; sparepart: sellPrice, unit dari master; service: basePrice, unit='jasa') → pop. Tampilkan stok pada subtitle product/sparepart.
- [ ] **Step E3:** `pos_screen.dart` — AppBar 'Transaksi', ListView baris keranjang (nama, qty stepper +/-, harga, subtotal baris, ikon hapus; baris product: `SwitchListTile` 'Pasang unit' → expand `TextFormField` lokasi ruangan + `DropdownButtonFormField` teknisi dari `techniciansProvider` (item pertama 'Belum ditentukan' = null)); footer Card ringkasan (subtotal/diskon/pajak/transport/total via `computeCartTotals`) + FAB 'Tambah Item' (buka picker) + `FilledButton` key `to-checkout` 'Checkout' (disabled saat keranjang kosong) → `context.go('/pos/checkout')`.
- [ ] **Step E4:** `checkout_screen.dart` — Form pola `member_form_screen`: nama & HP wajib (key 'name','phone'), alamat, diskon/pajak%/transport (`TextFormField` angka, key 'discount','taxPercent','transportFee'), catatan, ringkasan total, tombol submit key 'submit' 'Buat Transaksi' dengan `_busy` guard: `buildCheckoutPayload` → `checkoutCaller` → sukses: `cartProvider.clear()`, SnackBar nomor invoice, `context.go('/transactions/{invoiceId}')`; gagal: SnackBar merah `AppColors.danger`, tetap di form (pola `unit_form_screen._submit`).
- [ ] **Step E5:** Widget test — `pos_screen_test.dart` (2 test, override master providers dgn `FakeCrudRepository` seed + `techniciansProvider` value kosong: buka picker & tap produk → baris muncul & total benar; toggle pasang → field lokasi muncul). `checkout_screen_test.dart` (2 test, override `checkoutCallerProvider` fake yang merekam payload: submit kosong → 'Wajib diisi', fake tidak terpanggil; isi valid (cart di-seed via `ProviderScope` overrides `cartProvider`) → payload berisi phone ternormalisasi & installations benar, navigasi ke detail). Viewport tinggi pola `_useTallViewport`.
- [ ] **Step E6:** `flutter analyze` bersih + `flutter test` lulus. Commit: `feat(app): keranjang pos + checkout`

### Task F: Riwayat invoice + pembayaran + struk PDF

**Files:**
- Create: `app/lib/features/transactions/invoice_list_screen.dart`
- Create: `app/lib/features/transactions/invoice_detail_screen.dart`
- Create: `app/lib/features/transactions/payment_form_sheet.dart`
- Create: `app/lib/features/transactions/receipt_pdf.dart`
- Test: `app/test/features/transactions/payment_form_sheet_test.dart`

**Interfaces:**
- Consumes: providers Task D; `Invoice.sisa`; `Printing.layoutPdf` (pola `unit_label_pdf`).
- Produces: `Future<Uint8List> buildReceiptPdf(Invoice invoice, List<ManualPayment> payments)` — `PdfPageFormat.roll80`; isi: 'Ayub Podo Rukun', nomor invoice, tanggal, pelanggan, tabel item (nama, qty×harga, line total), subtotal/diskon/pajak/transport/total, daftar pembayaran (label metode + nominal), sisa, status label.

- [ ] **Step F1:** `invoice_list_screen.dart` — pola `MasterListScaffold`-like sederhana: AppBar 'Riwayat', ListView dari `invoicesStreamProvider`: title `number`, subtitle `customerName` + total (format `Rp`), trailing `Chip` label status (warna: lunas=success, dp=warning, belum_dibayar=danger dari `AppColors`); tap → `/transactions/:id`. (Tanpa FAB — transaksi dibuat dari /pos.)
- [ ] **Step F2:** `invoice_detail_screen.dart` — watch `invoiceProvider(id)` + `invoicePaymentsProvider(id)`: kartu info (number, tanggal, pelanggan, status chip), daftar item, ringkasan angka, daftar pembayaran (metode label, nominal, waktu), tombol `Catat Pembayaran` key 'add-payment' (hilang bila status lunas) → buka `payment_form_sheet`, tombol `Bagikan Struk` key 'print-receipt' → `Printing.layoutPdf(onLayout: (_) => buildReceiptPdf(...))`.
- [ ] **Step F3:** `payment_form_sheet.dart` — `showModalBottomSheet` berisi Form: dropdown metode key 'method' (dari `PaymentMethod.values`), nominal key 'amount' (wajib, int > 0). Aturan nominal: metode **tunai** = uang diterima — boleh > sisa, tampilkan `Text` key 'change' 'Kembalian: Rp X' (X = input − sisa) dan yang dikirim ke server = `min(input, sisa)`; metode **non-tunai** = validator tolak input > sisa ('Melebihi sisa tagihan'). Catatan opsional; submit key 'pay-submit' → `recordPaymentCaller` → pop + SnackBar; gagal → SnackBar merah.
- [ ] **Step F4:** Widget test `payment_form_sheet_test.dart` (2 test, override `recordPaymentCallerProvider` fake perekam + host sheet dgn invoice sisa 50000: nominal kosong → validasi & fake tak terpanggil; tunai 100000 → tampil 'Kembalian: Rp 50.000' (format `Rp`) dan payload amount 50000 method 'tunai').
- [ ] **Step F5:** `flutter analyze` + `flutter test` lulus. Commit: `feat(app): riwayat invoice, pembayaran manual, struk pdf`

### Task G: Routing + guard + navigasi + rules

**Files:**
- Modify: `app/lib/core/router/app_router.dart` (routes `/pos`, `/pos/checkout`, `/transactions`, `/transactions/:id` dalam ShellRoute)
- Modify: `app/lib/core/router/redirect.dart`
- Modify: `app/lib/core/widgets/adaptive_scaffold.dart`
- Modify: `firestore.rules`
- Test: `app/test/core/redirect_test.dart`, `app/test/core/adaptive_scaffold_test.dart`

**Interfaces (Produces):**
- `redirect.dart`: tambah `const _kasirAdminPrefixes = ['/pos', '/transactions'];` — role teknisi di prefix tsb → `'/'` (pola `_isAdminOnly`).
- `adaptive_scaffold.dart`: kasir = [Dashboard, Transaksi(/pos, `Icons.point_of_sale`), Riwayat(/transactions, `Icons.receipt_long_outlined`)] = **3**; admin sisipkan Transaksi+Riwayat setelah Dashboard = **9**; teknisi tetap 2. Hapus komentar "kasir hanya Dashboard".
- `firestore.rules`: `transactions/{id}` + `match /items/{itemId}` nested, `invoices`, `manual_payments`, `stock_movements`: `allow read: if signedIn() && (role() == 'admin' || role() == 'kasir'); allow write: if false;`. `service_orders`, `technician_jobs`: `allow read: if signedIn(); allow write: if false;` (Fase 5 memperketat per teknisi). `users/{uid}`: read juga untuk kasir (`role() == 'kasir'`) — dibutuhkan dropdown teknisi.

- [ ] **Step G1:** Update test dulu — `redirect_test.dart` +4 kasus (kasir `/pos` → null; teknisi `/pos` → `/`; kasir `/transactions/abc` → null; teknisi `/transactions` → `/`); `adaptive_scaffold_test.dart` (admin 9 memuat Transaksi & Riwayat; kasir 3; teknisi 2 tetap). `flutter test` FAIL.
- [ ] **Step G2:** Implement redirect + destinations + routes (import 4 screen baru; `/transactions/:id` → `InvoiceDetailScreen(invoiceId: state.pathParameters['id']!)`). Test PASS.
- [ ] **Step G3:** Update `firestore.rules`. `flutter analyze` + `flutter test` full lulus. Commit: `feat(app): routing pos + guard kasir + rules fase 4`

---

## Commits (urutan)

1. `feat(functions): util pos — telepon, total, nomor & status invoice`
2. `feat(functions): checkoutTransaction atomik dengan member otomatis & job pemasangan`
3. `feat(functions): recordPayment manual & status invoice`
4. `feat(app): model invoice & pembayaran + repositori/providers`
5. `feat(app): keranjang pos + checkout`
6. `feat(app): riwayat invoice, pembayaran manual, struk pdf`
7. `feat(app): routing pos + guard kasir + rules fase 4`

## Definisi Selesai

- `npm test` functions lulus (6 lama + ±19 baru) dan `npm run build` bersih.
- `flutter analyze` bersih; `flutter test` lulus (62 lama + ±16 baru).
- Verifikasi emulator manual: login kasir → keranjang (AC qty 1 + toggle pasang + jasa) → checkout → member baru muncul, stok berkurang, `stock_movements` tercatat, invoice `INV-…-0001` status Belum Dibayar, unit AC dgn barcode + service_order + technician_job dibuat → catat pembayaran DP (status DP) → pelunasan (Lunas) → tolak bayar melebihi sisa → struk PDF tampil → kasir TIDAK bisa buka `/members`, teknisi TIDAK bisa buka `/pos`.
