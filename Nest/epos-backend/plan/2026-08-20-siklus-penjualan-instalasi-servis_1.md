# E-POS AC — Siklus 1: Penjualan → Instalasi → QR → Servis Teknisi → Pelunasan (Backend NestJS)

> **Status: SUDAH DIIMPLEMENTASI.** Dokumen ini awalnya ditulis sebagai plan sebelum coding dimulai, dan berisi beberapa asumsi yang BELAKANGAN ketauan salah setelah dicocokin ke SQL migration asli (`backend/supabase/migrations` punya rekan tim). Dokumen ini sudah di-**rewrite** supaya isinya sama persis dengan yang beneran jalan di `epos-backend/src/` sekarang — bukan lagi rencana, tapi catatan "as-built". Kalau ada bagian kode yang berubah lagi nanti, tolong update dokumen ini juga biar gak basi lagi.

**Goal:** Kasir jual unit AC + instalasi → sistem generate kode QR/barcode unit → Teknisi antri, scan barcode, upload foto sebelum/sesudah, ajukan sparepart tambahan kalau perlu → job selesai → Kasir catat pelunasan → semua kejadian penting nongol realtime ke dashboard admin.

**Architecture:** NestJS modular monolith (1 service, per-domain module). Prisma 7.x + driver adapter (`@prisma/adapter-pg`) ke PostgreSQL mandiri (bukan Supabase). Auth JWT stateless. Realtime pakai Socket.IO gateway (`@nestjs/websockets`). Row locking eksplisit (`SELECT ... FOR UPDATE`) buat semua operasi stok.

---

## Koreksi penting dari draft awal (kenapa dokumen ini di-rewrite)

Draft awal siklus ini disusun sebelum SQL migration asli rekan tim dicek baris-per-baris. Setelah dicocokin, ada 2 asumsi besar yang **salah** dan sudah diperbaiki di implementasi final:

1. **TIDAK ADA tabel checklist per job.** Draft awal nyaranin bikin `technician_job_checklist_items` (Admin assign daftar checklist ke Teknisi, teknisi centang satu-satu). Sistem asli (`update_technician_job_status` RPC) **gak punya konsep ini sama sekali**. Progress job digerbang oleh 3 hal yang sudah ada di kolom lain: scan barcode harus cocok unit di job itu, foto `kind='sebelum'` harus ada sebelum job bisa "mulai", dan foto `kind='sesudah'` + semua `material_requests` sudah diputuskan (gak ada yang `pending`) + yang `approved` sudah ditandai `used` sebelum job bisa "selesai". Implementasi final TIDAK punya tabel checklist.
2. **TIDAK ADA langkah verifikasi pembayaran terpisah.** Draft awal nyaranin status `menunggu_verifikasi → terverifikasi → ditolak` buat `manual_payments` (kasir upload bukti transfer, lalu ada admin yang meng-acc baru duitnya masuk ke invoice). Sistem asli (`record_payment` RPC) **langsung apply** pembayaran ke invoice begitu diinput — kasir dipercaya penuh karena dia yang pegang uang/bukti transfer secara langsung saat itu juga. Implementasi final TIDAK punya status verifikasi pada `ManualPayment`.

Selain itu, konflik `technician_id NOT NULL` yang diributkan di draft awal (dan di roadmap) **sudah diselesaikan**: kolom itu sengaja dibikin nullable di `schema.prisma` kita sendiri (lihat migration `20260822000000_technician_job_nullable_technician`), karena skema ini independen — bukan clone 1:1 skema Supabase asli.

---

## Struktur modul yang beneran ada (`src/`)

```
src/
  auth/              → login, JwtStrategy, JwtAuthGuard, RolesGuard, @Roles(), @CurrentUser()
  users/             → CRUD user (admin/kasir/teknisi), admin-only
  products/          → master produk AC (unit yang dijual+dipasang)
  spareparts/        → master sparepart + search
  services-catalog/  → master jasa servis (cuci, dll)
  members/           → MembersService.findOrCreate + normalizePhone (dipakai POS & ServiceOrders)
  ac-units/          → unit AC customer: generate+lookup barcode QR
  counters/          → CountersService generik, nomor urut atomik (invoice & barcode)
  pos/               → checkout retail + instalasi (jantung siklus ini)
  technician-jobs/   → antrian, status, foto, catatan, material request, riwayat
  material-requests/ → pengajuan sparepart tambahan dari teknisi + approval admin
  payments/          → pembayaran manual (langsung apply, TANPA verifikasi terpisah)
  invoices/          → detail invoice buat cetak nota
  realtime/          → WebSocket gateway (room `admin-dashboard`)
  common/            → StockLockingService, invoice-status.util, HTTP exception filter
  prisma/            → PrismaService (driver adapter pg)
```

`service-orders/` dan notifikasi WA belum ada di siklus ini — `service-orders/` baru diisi di Siklus 2, notifikasi WA (`whatsapp_logs`) belum dibangun sama sekali (next cycle, lihat roadmap).

---

## Auth & RBAC

- JWT payload `{ sub: userId, role }`, `signAsync` via `@nestjs/jwt`.
- `JwtAuthGuard` + `RolesGuard` + `@Roles('admin'|'kasir'|'teknisi')` di tiap route. Route tanpa `@Roles()` = semua role yang login boleh akses.
- `@CurrentUser()` decorator ambil `{ sub, role }` dari request (di-`import type` terpisah dari value `CurrentUser` karena constraint `isolatedModules`).
- Seed admin: `admin@toko.local` / `ganti-password-ini` lewat `prisma/seed.ts` (`npx prisma db seed` — WAJIB dijalanin manual sekali di awal, gak otomatis).

## Master Data

`ProductsModule`, `SparepartsModule`, `ServicesCatalogModule`: pola sama — `POST` admin-only, `GET` semua role login. `SparepartsController` ada tambahan `GET /spareparts/search?q=` buat autocomplete pengajuan material.

`UsersModule`: `POST /users` (admin, hash password pakai bcrypt), `PATCH /users/:id/toggle-active` (admin), `GET /users` (admin, list semua user).

## Member, Unit AC & QR/Barcode

`MembersService.findOrCreate(tx, name, phone, address)` — cari member existing by nomor HP ternormalisasi (`normalizePhone`), bikin baru kalau belum ada. Dipakai bareng oleh `PosService` dan (di Siklus 2) `ServiceOrdersService`.

`AcUnitsService`:
- `formatBarcode(date, seq)` → format `ACUNIT-YYYYMMDD-NNNN`.
- `createForInstallation(tx, memberId, product, roomLocation)` — dipanggil pas checkout dengan instalasi produk baru. Status awal unit: `menunggu_pemasangan`.
- `lookupByBarcode(barcodeValue)` — **endpoint kunci requirement teknisi**: scan QR/barcode, data customer+unit+job aktif otomatis tampil, TANPA input manual. `GET /ac-units/lookup/:barcodeValue`, role admin/kasir/teknisi.
- QR image-nya sendiri **tidak digenerate/disimpan di server** — cuma string `barcodeValue` yang disimpan permanen di `member_ac_units.barcode_value`. Gambar QR-nya dirender ulang di sisi client (frontend) kapan pun dibutuhkan, deterministik dari string yang sama.
- Akses ke data lewat barcode WAJIB login (JWT) — ini yang jadi lapisan keamanan "QR doang gak cukup buat buka data", bukan password tersembunyi di dalam QR.

## POS: Checkout Retail + Instalasi

`StockLockingService.lockAndDeduct(tx, kind, id, qty)` — `SELECT ... FOR UPDATE` sebelum kurangi stok produk/sparepart, dipanggil di dalam Prisma interactive transaction. Item di-lock terurut by `refId` (bukan urutan submit) buat cegah deadlock antar 2 checkout paralel.

`PosService.checkout(dto, actorId)` — port 1:1 `checkout_transaction` RPC:
1. Validasi: `discountReason` wajib kalau `discount > 0`, item duplikat ditolak, qty produk harus bulat.
2. `MembersService.findOrCreate`.
3. Kunci & kurangi stok / ambil harga tiap item (jasa gak kena stock lock).
4. Hitung total (`pos-calc.util.ts`: `computeTotals`), tolak kalau diskon > subtotal.
5. Buat `Transaction` + `TransactionItem` + `StockMovement` (reason `penjualan`).
6. Buat `Invoice` (`INV-YYYYMMDD-NNNN` via `CountersService`, status awal `belum_dibayar`) + `InvoiceItem` + `InvoiceAdjustment` kalau ada diskon.
7. Kalau ada `installations[]`: buat `ServiceOrder` (type `pemasangan`) + `AcUnitsService.createForInstallation` + `ServiceOrderUnit` + `TechnicianJob` (lewat `TechnicianJobsService.createForOrder` — method bareng yang juga dipakai Siklus 2, status otomatis `assigned` kalau `technicianId` diisi, `menunggu_penugasan` kalau belum).
8. `AuditLog` + return `{ invoiceId, invoiceNumber, transactionId, memberId, serviceOrderId }`.

Endpoint: `POST /pos/checkout` (role admin, kasir — **kedua role boleh isi diskon**, sudah dikonfirmasi ke user, tidak dibatasi admin-only meskipun sempat diflag sebagai potential hardening item).

## Antrian & Pengerjaan Servis Teknisi

Vokabuler status ASLI (`update_technician_job_status` RPC): `menunggu_penugasan → assigned → sedang_dikerjakan → selesai / dibatalkan`. TIDAK ADA `in_progress` (itu istilah draft lama yang salah).

`TechnicianJobsService`:
- `myQueue(technicianId)` — `GET /technician-jobs/queue` (role teknisi), `technicianId` WAJIB dari JWT `sub`, bukan query param.
- `findAll(status?)` — `GET /technician-jobs` (role admin, kasir) — ditambahkan buat kebutuhan uji coba, gak ada di RPC manapun.
- `findOne(jobId)` — `GET /technician-jobs/:id` (admin, kasir, teknisi) — detail lengkap termasuk foto & pengajuan material.
- `createForOrder(tx, params)` — shared method bikin job baru (dipakai `PosService` & `ServiceOrdersService` Siklus 2), TANPA checklist.
- `history(technicianId, page, pageSize)` — `GET /technician-jobs/history` (role teknisi) — riwayat job `selesai` milik sendiri (Siklus 2).
- `assign(jobId, technicianId)` — `PATCH /technician-jobs/:id/assign` (admin, kasir). Validasi teknisi `role='teknisi'` & `active=true`.
- `start(jobId, scannedBarcode, actorId, role)` — `PATCH /technician-jobs/:id/start` (admin, teknisi). Gate: status harus `assigned`, barcode WAJIB cocok `unit.barcodeValue`, foto `sebelum` WAJIB sudah ada. Admin bisa bypass ownership check (`assertOwnerOrAdmin`), teknisi cuma boleh job miliknya sendiri.
- `addPhoto(jobId, kind, path, actorId, role)` — `POST /technician-jobs/:id/photos` (admin, teknisi), Multer disk storage lokal, serve via `/uploads`.
- `updateNotes(jobId, notes, actorId, role)` — `PATCH /technician-jobs/:id/notes`.
- `complete(jobId, actorId, role)` — `PATCH /technician-jobs/:id/complete`. Gate: status `sedang_dikerjakan`, foto sebelum+sesudah lengkap, TIDAK ada `material_request` berstatus `pending`, semua yang `approved` sudah `usedAt` terisi. Efek: `MemberAcUnit.status` jadi `aktif` (kalau `type='pemasangan'`) + `lastServiceDate`/`nextServiceDate` (+3 bulan) ke-update, auto-close `ServiceOrder.status='selesai'` kalau semua job di order itu sudah selesai/dibatalkan.
- `cancel(jobId, role)` — `PATCH /technician-jobs/:id/cancel` (admin only), gak bisa kalau sudah `selesai`.

## Pengajuan Material Tambahan (`MaterialRequestsService`)

Alur ASLI (beda dari draft lama yang langsung potong stok sekali jalan): teknisi ajukan (`status='pending'`, **belum** potong stok) → admin `decide` (approve/revise/reject) → kalau approve/revise, `InvoiceAdjustment` nambah tagihan invoice (sticky `kurang_bayar` kalau invoice sudah `lunas`, lihat bagian Payments) → teknisi/admin `markUsed` — **baru di sini** stok beneran dipotong.

- `create(jobId, dto, actorId, role)` — `POST /technician-jobs/:jobId/materials`. Job harus `assigned`/`sedang_dikerjakan`.
- `decide(requestId, dto, actorId)` — `PATCH /material-requests/:id/decide` (admin only).
- `markUsed(requestId, actorId, role)` — `PATCH /material-requests/:id/mark-used` (admin, teknisi pemilik job) — di sinilah `StockLockingService.lockAndDeduct` dipanggil.

## Pembayaran & Invoice

`InvoiceStatus` enum real (6 nilai, BUKAN 3 seperti draft lama): `belum_dibayar, dp, kurang_bayar, lunas, refund, batal`. `kurang_bayar` itu **sticky** — begitu invoice pernah `kurang_bayar` (invoice yang tadinya `lunas` lalu tagihannya naik lagi karena pengajuan sparepart di-approve), status itu bertahan sampai lunas lagi, gak boleh turun balik ke `dp` biasa. Logic ini di `common/invoice-status.util.ts` → `computeInvoiceStatus(grand, paid, current)`, port 1:1 dari `compute_invoice_status()` RPC.

`PaymentsService.record(invoiceId, dto, actorId)` — `POST /invoices/:id/payments` (admin, kasir). **LANGSUNG apply** ke invoice (row-locked via `SELECT ... FOR UPDATE`), TANPA status verifikasi terpisah. Tolak kalau invoice `batal`/`refund`, atau `amount` melebihi sisa tagihan.

`InvoicesController.findOne(id)` — `GET /invoices/:id`, data lengkap (items, adjustments, manualPayments, member) siap dipakai render/cetak nota di frontend. `findAll()` — `GET /invoices` (riwayat, ditambahkan buat uji coba).

## Realtime

`RealtimeGateway` (`@nestjs/websockets`, Socket.IO, CORS `origin: '*'`). `emitToAdmin(event, payload)` ke room `admin-dashboard`. Event yang di-emit: `transaction.created`, `job.status_changed`, `invoice.updated`, `material_request.created`, `material_request.decided`. Client join room lewat `emit('join-admin-dashboard')`. Autentikasi socket dari JWT handshake **belum diimplementasi** (masih TODO produksi, sekarang siapa aja yang tau URL bisa join room — cukup aman untuk skala 1 toko + dev/testing, tapi perlu diperbaiki sebelum benar-benar publik).

---

## Kondisi implementasi saat ini

Semua di atas **sudah dibangun dan berjalan** di `epos-backend/`. Sudah ada frontend uji coba sederhana (`epos-backend/frontend/`) buat menjalankan siklus end-to-end tanpa Postman: login → master data → checkout+instalasi → job board (assign/scan/foto/material/complete) → invoice+pembayaran, plus log realtime.

**Belum dibangun di siklus ini (sesuai rencana, next cycle):** voucher/diskon campaign, notifikasi WA yang beneran terkirim (baru catat log `pending`, belum ada worker Fonnte), mode offline Flutter, laporan/dashboard analitik, manajemen stok (barang masuk/opname), kas & shift kasir, retur/refund. Lihat roadmap (`2026-08-20-roadmap-siklus-epos_1.md`) untuk urutan siklus berikutnya.
