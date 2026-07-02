# Design Doc — E-POS AC Realtime (Admin, Kasir, Teknisi)

Tanggal: 2026-07-03
Status: Disetujui user (Syakir), siap masuk tahap implementation plan
Sumber kebutuhan: `Dokumen_Fitur_EPOS_AC_Mobile_Realtime.docx` (draft 22 Mei 2026)

## 1. Ringkasan

Sistem E-POS untuk bisnis penjualan AC, sparepart, dan jasa (pasang, cuci, service, maintenance). Tiga role: Admin, Kasir, Teknisi. Data realtime via Firebase. Scope build ini: **MVP wajib sesuai bab 11.1 dokumen fitur** — login role, master data, transaksi POS, member otomatis, unit AC + barcode, order & job teknisi, foto wajib, pengajuan tambahan + approval, pembayaran manual, invoice, stok + mutasi, dashboard realtime, laporan dasar.

## 2. Keputusan Arsitektur

### ADR-1: Satu codebase Flutter untuk Android, iOS, dan Web
- **Keputusan:** Flutter (Dart) satu codebase, build ke Android, iOS, dan Web (deploy ke Firebase Hosting). Layout responsif: navigasi bottom-bar di mobile, side-rail/drawer di layar lebar.
- **Alasan:** kerja 1x untuk 3 platform, logika bisnis konsisten, integrasi Firebase matang (FlutterFire), realistis untuk MVP.
- **Trade-off yang diterima:** initial load Flutter Web lebih berat dari web native; scan barcode via kamera browser lebih terbatas (mitigasi: `mobile_scanner` mendukung web + input kode manual sebagai fallback).
- **Alternatif ditolak:** web terpisah Next.js (2 codebase, duplikasi logika, waktu ~2x).

### ADR-2: Cloud Functions untuk operasi kritis (paket Blaze)
- **Keputusan:** logika yang menyentuh uang dan stok berjalan di Cloud Functions (TypeScript, callable functions), bukan di client.
- **Alasan:** client tidak boleh bisa memanipulasi total invoice, stok, status pembayaran, dan nomor urut; validasi business rules terpusat.
- **Konsekuensi:** butuh upgrade project Firebase ke paket Blaze (pay-as-you-go, tetap ada kuota gratis; perlu kartu kredit).
- Development dan test penuh memakai **Firebase Emulator Suite** (gratis, offline).

### ADR-3: State management dan routing
- Riverpod (provider berbasis stream Firestore untuk realtime), go_router dengan redirect guard berbasis role, freezed + json_serializable untuk model data.

## 3. Komponen Sistem

| Komponen | Teknologi | Tanggung jawab |
|---|---|---|
| Aplikasi client | Flutter (Android/iOS/Web) | UI per role, subscribe realtime Firestore, scan barcode, upload foto, panggil callable functions |
| Firebase Auth | email/password + custom claims | Login, role (`admin`/`kasir`/`teknisi`), nonaktifkan akun |
| Cloud Firestore | koleksi bab 10 dokumen | Sumber data realtime tunggal |
| Firebase Storage | folder per job | Foto sebelum/sesudah/kerusakan (tidak bisa dihapus teknisi) |
| Cloud Functions | TypeScript callable + trigger | Checkout, pembayaran, approval, pemakaian stok, nomor urut, set role, notifikasi |
| FCM | via trigger Functions | Notifikasi job baru, pengajuan, approval, stok menipis, kurang bayar |
| Firebase Hosting | build web Flutter | Akses web semua role |

## 4. Data Model (Firestore)

Mengikuti bab 10 dokumen fitur dengan penyederhanaan berikut:

- `transactions/{id}/items` — item transaksi sebagai **subcollection** (bukan koleksi terpisah `transaction_items`).
- Item pengajuan disimpan sebagai **array di dalam dokumen** `additional_part_requests` dan `installation_material_requests` (jumlah item per pengajuan sedikit; menghindari 2 koleksi item terpisah).
- Barcode disimpan sebagai field unik `barcode_value` di `member_ac_units` (isi barcode = ID unit, sesuai aturan bab 5.5); tidak perlu koleksi `ac_unit_barcodes`. Keunikan dijamin Function saat generate.
- `service_order_units` menjadi array `units[]` di dalam `service_orders` (status per unit tetap ada di tiap elemen).
- `job_spareparts` menjadi subcollection `technician_jobs/{id}/used_items`.
- Tidak ada koleksi `roles` — role cukup custom claim + field `role` di `users`.

Koleksi final: `users`, `members`, `member_ac_units`, `products`, `spareparts`, `services`, `installation_packages`, `transactions` (+`items`), `invoices`, `manual_payments`, `service_orders`, `technician_jobs` (+`used_items`), `job_photos`, `additional_part_requests`, `installation_material_requests`, `stock_movements`, `invoice_adjustments`, `notifications`, `audit_logs`, `settings`.

Field inti per koleksi mengikuti tabel dokumen fitur (member: phone sebagai identitas unik; unit AC: brand, model, pk, room_location, barcode_value, serial_number, tanggal pasang/service, status; dst). Status enum mengikuti bab 7 dokumen.

## 5. Permukaan Cloud Functions

Callable (dipanggil client, semua validasi role + input di server):

1. `checkoutTransaction` — atomik: cek/buat member by phone → simpan transaksi + items → potong stok penjualan + mutasi → buat invoice (nomor urut) → jika beli AC + jasa pasang: buat unit AC (status Menunggu Pemasangan) + barcode + service order + job pemasangan.
2. `recordPayment` — tambah pembayaran manual → hitung ulang total bayar/sisa → set status invoice (Belum Dibayar/DP/Kurang Bayar/Lunas).
3. `decideRequest` — approve/revisi/tolak pengajuan (sparepart atau material) → jika approve: buat `invoice_adjustments`, update total invoice + status pembayaran → notifikasi teknisi → audit log.
4. `markItemsUsed` — tandai item approved sebagai digunakan → potong stok + `stock_movements` → catat di `used_items`.
5. `startJob` / `completeJob` — validasi server: foto sebelum ada (start), foto sesudah ada + tidak ada pengajuan pending (complete) → update status job, unit AC, histori service, `last_service_date`.
6. `generateAcUnitBarcode` — nomor urut `ACUNIT-YYYYMMDD-XXXX`, jamin unik.
7. `manageUser` — Admin buat/nonaktifkan akun Kasir/Teknisi + set custom claim role.
8. `adjustStock` — barang masuk/koreksi/rusak/retur oleh Admin + mutasi stok.

Trigger: `onNotificationCreated` → kirim FCM; `onAuditableWrite` (di dalam functions di atas, tulis `audit_logs` langsung — bukan trigger terpisah agar atomik).

## 6. Penegakan Business Rules (bab 8 dokumen)

| Rule | Client (UX) | Server |
|---|---|---|
| Foto sebelum wajib untuk mulai | Tombol terkunci | `startJob` menolak jika foto belum ada |
| Foto sesudah wajib untuk selesai | Tombol terkunci | `completeJob` menolak |
| Tidak boleh selesai jika ada pengajuan pending | Tombol terkunci + banner | `completeJob` menolak |
| Foto tidak bisa dihapus | Tidak ada tombol hapus | Storage + Firestore rules: no delete/update |
| Barcode harus sesuai job | Validasi hasil scan vs unit di job | `startJob` menerima `scannedUnitId`, cek kecocokan |
| Stok berkurang hanya saat dijual/digunakan | — | Hanya Functions yang menulis stok & mutasi |
| Invoice berubah hanya via approval | — | Hanya `decideRequest`/`recordPayment`/`checkoutTransaction` yang menulis invoice |
| Teknisi hanya lihat job miliknya | Query difilter | Rules: `technician_id == request.auth.uid` |
| Member unik by nomor HP | Cek saat input | `checkoutTransaction` lookup by phone (normalisasi +62) |

Security Rules: role dibaca dari custom claims; koleksi finansial (invoices, manual_payments, stock_movements, invoice_adjustments, audit_logs) **read-only dari client** sesuai role, tulis hanya via Functions (Admin SDK bypass rules). Teknisi tidak melihat harga beli.

## 7. Struktur Repo (monorepo)

```
/                      ← folder proyek ini (git root)
├── app/               ← Flutter
│   └── lib/
│       ├── core/      ← theme (teal #0F766E dst bab 5.20), router, widgets umum, utils, constants
│       ├── data/      ← models (freezed), repositories per koleksi, firebase service
│       └── features/  ← auth, dashboard, members, ac_units, products, spareparts,
│                        services_master, pos, payments, orders, jobs, requests,
│                        stock, reports, notifications, settings  (tiap feature: screens/ + providers/ + widgets/)
├── functions/         ← Cloud Functions TypeScript (src/ per domain: checkout, payments, requests, jobs, stock, users)
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── firebase.json      ← config emulator + hosting
└── docs/superpowers/  ← spec ini + implementation plan
```

## 8. Fase Implementasi

1. **Fondasi** — scaffold Flutter + functions, konfigurasi Firebase & emulator, Auth + custom claims + seed akun admin, tema teal, router + guard role, shell layout responsif.
2. **Master data (Admin)** — CRUD produk AC, sparepart/material, jasa, paket instalasi; kategori & satuan sesuai dokumen.
3. **Member & unit AC** — CRUD member (phone unik), unit AC per member, generate barcode + cetak label (PDF), scan barcode (`mobile_scanner`).
4. **POS & pembayaran** — keranjang (AC/sparepart/jasa), diskon/pajak/transport/DP/catatan, `checkoutTransaction`, invoice + struk (share PDF/gambar), `recordPayment` semua metode manual.
5. **Order & job teknisi** — buat order (multi-unit), assign teknisi, layar job teknisi, scan validasi, foto sebelum/sesudah (Storage), diagnosa, `startJob`/`completeJob`, histori per unit.
6. **Pengajuan tambahan** — form pengajuan sparepart (service) & material (instalasi, hitung selisih paket otomatis), `decideRequest`, `markItemsUsed`, notifikasi realtime.
7. **Stok, dashboard, laporan, notifikasi** — barang masuk/koreksi, mutasi stok, peringatan stok minimum, dashboard per role (bab 5.2), laporan dasar (penjualan, stok, pembayaran, job), FCM.
8. **Pengerasan & rilis** — security rules final + test rules, audit log lengkap, unit/widget test, deploy Hosting + build APK, dokumentasi setup.

Setiap fase diakhiri verifikasi di emulator sebelum lanjut.

## 9. Testing

- **Unit test (Dart + TS):** hitung status invoice, total + adjustment, selisih paket material, normalisasi nomor HP, nomor urut.
- **Emulator test:** Functions (checkout, approval, stok) dan Security Rules (akses per role, larangan hapus foto, larangan tulis koleksi finansial).
- **Widget test:** flow POS checkout, gate foto teknisi, gate pengajuan pending.

## 10. Di Luar Scope (tahap lanjutan dokumen bab 11.2)

Export PDF/Excel laporan, printer Bluetooth, offline mode penuh, reminder maintenance berkala, kontrak corporate, rating teknisi, multi-cabang, payment gateway. Struktur data tidak menghalangi penambahan ini nanti.

## 11. Pertanyaan Terbuka (bab 13 — dikonfirmasi saat implementasi, default sementara)

- Limit approval Kasir → default: Kasir boleh approve semua (sama dengan Admin).
- Foto kerusakan saat pengajuan → default: opsional.
- Satu job multi-teknisi → default: satu teknisi per job.
- Kirim invoice via WhatsApp → default: share PDF via share sheet OS (termasuk WA).
- Teknisi lihat harga → default: teknisi melihat harga jual, tidak melihat harga beli.
