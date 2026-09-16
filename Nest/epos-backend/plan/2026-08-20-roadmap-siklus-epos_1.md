# Roadmap & Checklist Siklus — E-POS AC (Backend NestJS)

> Dokumen ini peta keseluruhan proyek, dipecah jadi "siklus" (vertical slice yang bisa dites end-to-end sendiri). Tiap siklus punya plan detail terpisah (kayak yang udah dibuat buat Siklus 1). Update checkbox di bawah tiap kali plan detail atau implementasi kelar — biar progress keliatan tanpa harus buka semua file plan satu-satu.

**Cara baca status:**
- `[ ] Plan` = plan detail (task-by-task, kayak Siklus 1) belum/udah dibuat
- `[ ] Implementasi` = kode-nya udah jalan & lolos skenario tes di plan-nya

---

## Urutan pengerjaan (kenapa urutannya begini)

Siklus 1–3 itu fondasi: auth, master data, engine stok, engine job teknisi. Semua siklus lain numpang di atas engine yang sama (checkout & technician-jobs), jadi build-nya lebih murah kalau dikerjain belakangan. Siklus 9 (mobile offline) sengaja paling belakang sesuai strategi lo sendiri: **selesai & validasi di Web dulu, baru porting ke Flutter**.

```
1. Penjualan + Instalasi + QR + Servis + Pelunasan   ← SUDAH JALAN
2. Servis Masuk Mandiri (bukan dari pembelian)         ← SUDAH JALAN
3. Manajemen Stok (barang masuk, stock opname)         ← SUDAH JALAN
4. Kas & Shift Kasir                                   ← SUDAH JALAN
5. Checklist Temuan Servis + Review Admin              ← SUDAH JALAN (revisi 2026-08-22, lihat catatan)
6. Voucher & Diskon Campaign                           ← SUDAH DIKIRIM (2026-08-23, lihat catatan)
7. Reminder Servis via WhatsApp (worker beneran)       ← DITUNDA (nunggu API key Fonnte final)
8. Laporan & Dashboard                                 ← SUDAH DIKIRIM (2026-08-23, lihat catatan)
9. Mode Offline Teknisi (Flutter)                      ← SUDAH DIKIRIM (2026-08-23, vokabuler dirombak, lihat catatan)
10. Retur / Refund Barang (digeser dari slot Siklus 5 lama)
```

> **Revisi 2026-08-22:** Slot "Siklus 5" awalnya diisi Retur/Refund. Setelah
> dokumen requirement yang lebih otoritatif (`requirementepos 2.md`) dicek,
> ternyata ada gap yang lebih mendesak — sistem checklist pekerjaan servis +
> review admin, yang gak ada sama sekali di implementasi Siklus 1 & 2 yang
> udah jalan. Slot 5 dipakai buat itu duluan; Retur/Refund TETAP fitur nyata
> (dikonfirmasi requirement asli), cuma digeser jadi Siklus 10 di paling
> bawah. Detail lengkap: `2026-08-22-siklus-checklist-servis-review.md`.

---

## Siklus 1 — Penjualan + Instalasi + QR + Servis + Pelunasan

- [x] Plan — **sudah dibuat & di-rewrite jadi catatan as-built**: `2026-08-20-siklus-penjualan-instalasi-servis_1.md`
- [x] Implementasi — **SUDAH JALAN** di `epos-backend/src/`, ada frontend uji coba (`epos-backend/frontend/`)

**Requirement yang dicover:** transaksi penjualan retail (Kasir), generate QR unit barang (Fitur Teknis #1), antrian+scan+foto+catatan+sparepart tambahan teknisi (TANPA tabel checklist terpisah — gate dari foto+material request, lihat dokumen plan yang sudah di-rewrite), cetak nota/invoice (Fitur Teknis #7), pembayaran manual langsung apply TANPA langkah verifikasi terpisah (Fitur Teknis #8, koreksi dari asumsi awal), concurrency stock dasar (Fitur Teknis #5), fondasi real-time monitoring (Fitur Teknis #4).

**Belum dicover di sini (sengaja, next cycle):** diskon voucher, mode offline, laporan/dashboard, manajemen stok, kas & shift kasir, retur/refund, notifikasi WA yang beneran terkirim.

**Soal diskon Kasir vs Admin:** sempat diflag sebagai potential hardening item (cuma Admin yang boleh isi `discount`/`discountReason`), tapi **sudah dikonfirmasi ke user: tetap dibiarkan Admin DAN Kasir boleh isi diskon manual saat checkout** — bukan bug, keputusan produk final.

---

## ✅ Catatan silang-siklus (sudah SELESAI, bukan lagi open item)

`technician_jobs.technician_id` sudah dibikin nullable di `schema.prisma` kita sendiri (independen dari skema Supabase asli yang `NOT NULL`) — migration `20260822000000_technician_job_nullable_technician` sudah diterapkan. Baik Siklus 1 (checkout+instalasi) maupun Siklus 2 (intake servis mandiri) sama-sama bisa bikin `TechnicianJob` tanpa `technicianId` (`status='menunggu_penugasan'`) tanpa error.

---

## Siklus 2 — Servis Masuk Mandiri (bukan dari pembelian baru)

- [x] Plan — **sudah dibuat & di-rewrite jadi catatan as-built**: `2026-08-20-siklus-servis-masuk-mandiri.md`
- [x] Implementasi — **SUDAH JALAN**, reuse total engine job teknisi Siklus 1 (`TechnicianJobsService.createForOrder`, TANPA checklist)

**Requirement yang dicover:** Kasir "Terima servis masuk: input data customer, keluhan, kondisi barang → assign ke Teknisi", Teknisi "Riwayat servis yang pernah dikerjakan", Kasir "Cek status servis pelanggan".

**Kenapa perlu siklus terpisah:** Siklus 1 cuma nyiptain `service_orders` dari jalur instalasi produk baru (`type='pemasangan'`). Tapi customer bisa juga bawa unit AC lama yang udah kebeli sebelumnya buat diservis/diperbaiki tanpa transaksi jual-beli produk baru — ini jalur masuk berbeda (`type='perbaikan'` atau `type='reguler'`), gak lewat `pos/checkout` sama sekali.

**Yang perlu dibangun:**
- Endpoint `POST /service-orders/intake` — kasir input keluhan + kondisi barang + pilih `member_ac_units` existing (lewat scan QR unit yang sama dari Siklus 1, atau cari manual by nama/telepon) → bikin `service_orders` + `technician_jobs` (reuse checklist & status engine dari Siklus 1, **tidak perlu bikin ulang**).
- Endpoint `GET /service-orders?memberId=` atau `?phone=` — buat kasir cek status servis pelanggan.
- Endpoint `GET /technician-jobs/history?technicianId=` — riwayat servis teknisi (query `status='selesai'`).
- (Opsional, kecil) QR per customer (bukan cuma per unit) — kalau dibutuhin buat kartu member fisik, reuse `CountersService` + tabel baru simpel atau pakai `member.id` langsung sebagai value QR (gak perlu counter baru).

**Dependency:** Siklus 1 (engine technician-jobs & checklist harus udah jalan).

---

## Siklus 3 — Manajemen Stok (Admin)

- [x] Plan — **sudah dibuat**: `2026-08-20-siklus-manajemen-stok.md`
- [x] Implementasi — **SUDAH JALAN** (`src/stock/`), reuse `StockLockingService.lockAndAdd`

**Requirement yang dicover:** Admin "Manage stock (barang masuk, stock opname, transfer stock bila multi-cabang)".

**Catatan scope:** transfer stock multi-cabang **di-skip** — skala bisnis masih satu toko (sesuai konfirmasi final lo), jangan dikerjain dulu biar gak over-engineering.

**Yang perlu dibangun:**
- `POST /stock/in` — barang masuk (tambah stok produk/sparepart), catat `stock_movements` dengan `reason='barang_masuk'`, dan update `item_costs` (harga beli — tabel ini ada di schema tapi belum dipakai sama sekali sejauh ini, padahal krusial buat laporan laba-rugi di Siklus 8).
- `POST /stock/opname` — input hasil hitung fisik, hitung selisih, catat `stock_movements` dengan `reason='opname'` (qty_change bisa plus/minus), butuh audit log siapa yang opname.
- Reuse `StockLockingService` dari Siklus 1 buat operasi tambah/kurang stok yang sama — **jangan bikin service stok baru**, cukup extend method `lockAndDeduct` jadi juga punya `lockAndAdd`.

**Dependency:** Siklus 1 (`StockLockingService`).

---

## Siklus 4 — Kas & Shift Kasir

- [x] Plan — **sudah dibuat**: `2026-08-20-siklus-kas-shift-kasir.md`
- [x] Implementasi — **SUDAH JALAN** (`src/shifts/`, migration `20260822020000_cashier_shifts`)

**Requirement yang dicover:** Kasir "Buka/tutup kasir (cash management) & laporan shift harian".

**Yang perlu dibangun:**
- Tabel baru (belum ada di schema) — `cashier_shifts` (id, kasir_id, opening_balance, closing_balance, opened_at, closed_at, notes) via migration baru.
- `POST /shifts/open` (input modal awal), `POST /shifts/close` (input uang fisik akhir, sistem hitung selisih vs `total_paid` transaksi tunai selama shift itu).
- `GET /shifts/:id/report` — ringkasan transaksi per metode pembayaran selama shift.

**Dependency:** Siklus 1 (`manual_payments`, `invoices`).

---

## Siklus 5 — Checklist Temuan Servis + Review Admin

- [x] Plan — **sudah dibuat**: `2026-08-22-siklus-checklist-servis-review.md`
- [x] Implementasi — **SUDAH DIKIRIM** ke project (`prisma/schema.prisma`, migration
  `20260822030000_job_findings_checklist`, `TechnicianJobsService`/`Controller`, frontend tes).
  **Belum divalidasi end-to-end** — masih perlu jalanin `prisma migrate dev` +
  `prisma generate` + `prisma db seed` di project asli (blocked di sandbox
  karena network restriction ke `binaries.prisma.sh`), baru bisa dites beneran.

**Requirement yang dicover:** Admin "Assign checklist pekerjaan servis ke Teknisi", Teknisi "Update status pekerjaan per checklist" — checklist di sini artinya daftar **temuan masalah dinamis** (bukan template tetap), lihat plan doc untuk detail model.

**Yang dibangun:** model `ProblemCategory`/`JobFinding`/`JobFindingPhoto`, status job baru `menunggu_review` (+ `sendBack`), endpoint `findings`/`findings/:id/photos`/`submit-for-review`/`approve-complete`/`send-back`/`categories`. Foto level-job lama (`JobPhoto`) diganti foto per-temuan; endpoint `complete()` lama dihapus.

**Isu terbuka (belum dikerjakan, belum diputuskan):** requirement doc yang sama juga minta "Verifikasi Pembayaran Manual" (kasir approve bukti transfer sebelum invoice ke-apply) — konflik sama `PaymentsService.record()` yang udah jalan (langsung apply). Belum ada keputusan user soal ini, lihat bagian "Isu Terbuka" di plan doc Siklus 5.

**Dependency:** Siklus 1 & 2 (engine `TechnicianJobsService`).

---

## Siklus 6 — Voucher & Diskon Campaign

- [x] Plan — **sudah dibuat**: `2026-08-20-siklus-voucher-diskon.md`
- [x] Implementasi — **SUDAH DIKIRIM** ke project (`src/vouchers/*`, modifikasi `pos.service.ts`/`checkout.dto.ts`/`pos.module.ts`/`app.module.ts`, `src/members/members.controller.ts` baru, frontend tes). **Belum divalidasi end-to-end** — sama kayak Siklus 5, perlu `prisma migrate dev`/`generate` jalan dulu di project asli (blocked di sandbox).

**Requirement yang dicover:** Admin "Membuat campaign voucher & menawarkannya ke customer tertentu", Kasir "Terapkan voucher/diskon saat checkout", Fitur Teknis #6 (voucher campaign khusus kategori/first-purchase).

**Yang dibangun:**
- `POST /vouchers/campaigns` (admin) + `GET /vouchers/campaigns` (admin, kasir — ditambah buat kebutuhan frontend tes) — pakai tabel `voucher_campaigns` yang udah ada di schema.
- `POST /vouchers/campaigns/:id/offer` — admin pilih member tertentu (bukan broadcast) → insert `voucher_claims` status `ditawarkan`. Diproses per-member (1-2 member gagal gak bikin seluruh request gagal), dobel proteksi race condition (unique index + catch P2002).
- `GET /vouchers/my-claims?memberId=` — voucher yang bisa dipakai member tsb (dipanggil dari tombol "Cek Voucher" di tab POS).
- Logic deteksi "pembelian pertama kali per kategori" (`isEligibleFirstPurchase`) — raw query `transaction_items` yang WAJIB filter `kind='product'` dulu sebelum join ke `products` (kolom `ref_id` polymorphic), dicek DUA KALI: pas admin offer & pas checkout beneran (ada jeda waktu di antaranya).
- **Modifikasi ke `pos/checkout` Siklus 1**: tambah field `voucherClaimId` opsional di `CheckoutDto`, validasi claim (lock `FOR UPDATE`, sama pola `StockLockingService`) milik member ini & masih `diklaim`/`ditawarkan` & belum kadaluarsa, hitung potongan sesuai `discount_type`/`discount_value`, update `voucher_claims.status='dipakai'` + `invoice_id` dalam transaksi yang sama.
- **Keputusan bisnis dikonfirmasi 2026-08-23:** diskon ad-hoc (manual admin/kasir) dan diskon voucher **DIJUMLAH**, bukan pilih salah satu, kalau dua-duanya diisi di satu transaksi. Persentase voucher dihitung dari subtotal MENTAH (sebelum dikurangi diskon apapun), biar dua sumber diskon independen.
- **Tambahan di luar plan asli, tapi perlu biar fitur bisa dites**: `GET /members/search?q=` (`src/members/members.controller.ts`, baru — sebelumnya `MembersService` gak ada endpoint REST sama sekali) buat admin cari `memberId` by nama/HP saat mau nawarin voucher.

**⚠️ Isu terbuka (risiko, belum dikerjakan solusinya):** model `VoucherCampaign`/`VoucherClaim` udah ada di `prisma/schema.prisma` (ditambah sesi sebelumnya, katanya lewat `prisma db pull` ke DB asli), **TAPI gak ada migration file buat dua tabel ini** di `prisma/migrations/` manapun. Kalau tabelnya udah beneran ada secara fisik di database tapi Prisma migration history gak tau, `npx prisma migrate dev` bisa gagal (nyoba bikin ulang tabel yang udah ada). **Sebelum jalanin migrate**, cek dulu: kalau tabel `voucher_campaigns`/`voucher_claims` udah ada di DB, jalanin `npx prisma migrate resolve --applied <nama_migration_yang_sesuai>` buat "baseline" dua tabel itu (anggap udah diterapkan tanpa run ulang SQL-nya) — atau, kalau lebih simpel, `npx prisma db push` khusus buat bagian ini. Kalau tabelnya belum ada sama sekali, migrate biasa harusnya aman.

**Dependency:** Siklus 1 (checkout harus dimodif, bukan dibuat modul baru terpisah).

---

## Siklus 7 — Reminder Servis via WhatsApp (worker beneran)

- [x] Plan — **sudah dibuat**: `2026-08-20-siklus-reminder-wa.md`
- [ ] Implementasi

**Requirement yang dicover:** Fitur Teknis #3 (cron cek jatuh tempo servis, kirim WA via Fonnte, queue biar gak kena rate limit, tracking status kirim).

**Catatan:** Siklus 1 udah nyiptain *record* `whatsapp_logs` pas job servis selesai (status `pending`). Siklus ini yang bikin record itu **beneran terkirim**.

**Yang perlu dibangun:**
- `@nestjs/schedule` cron harian — query `member_ac_units.next_service_date <= today` yang belum ada `whatsapp_logs` terkait hari ini → enqueue job BullMQ.
- BullMQ processor — panggil API Fonnte (rate-limited sesuai konfigurasi, misal max N pesan/menit), update `whatsapp_logs.status` jadi `terkirim`/`gagal` + `provider_response`.
- **Prasyarat non-teknis:** API key & format request Fonnte harus final dulu (lo bilang masih belum final) — sebaiknya tunda mulai coding siklus ini sampai itu clear, biar gak kerja dua kali.

**Dependency:** Siklus 1 & 2 (sumber data `whatsapp_logs` & `next_service_date`).

---

## Siklus 8 — Laporan & Dashboard

- [x] Plan — **sudah dibuat**: `2026-08-20-siklus-laporan-dashboard.md`
- [x] Implementasi — **SUDAH DIKIRIM** ke project (`src/app-config/*`, `src/reports/*`, `src/dashboard/*` baru, `app.module.ts` di-wire, frontend tes tab "Laporan & Dashboard"). Modul baru murni query read-only (gak ada write ke tabel Siklus 1-6), jadi **kemungkinan besar gak butuh migration baru** — tapi tetap perlu `npx prisma generate` di project asli biar Prisma Client kenal type-nya, terus jalanin end-to-end.

**Requirement yang dicover:** Admin "Laporan: penjualan, servis, laba-rugi", Admin "Monitoring dashboard real-time (progress servis, transaksi, performa kasir/teknisi)", Admin "Setting aplikasi (pajak, printer, format nota, dll)".

**Yang dibangun:**
- `AppConfigModule` — `GET /app-config` (semua role login, kasir butuh baca `default_tax_percent`) + `PUT /app-config/:key` (admin-only), key-value ke tabel `app_config` yang udah ada di schema. `invoice_number_format` disimpen tapi **belum otomatis dipakai** di `formatInvoiceNumber()` — sesuai catatan plan, itu polish opsional, bukan task wajib siklus ini.
- `GET /reports/sales?from&to` — total penjualan/diskon/pajak, breakdown per kategori produk, grafik harian.
- `GET /reports/service?from&to` — jumlah job per status, rata-rata waktu pengerjaan, performa per teknisi.
- `GET /reports/profit-loss?from&to` — laba-rugi per item dari `item_costs` (Opsi (a) di plan: HPP pakai `buy_price` TERKINI, **bukan snapshot historis** — kalau harga beli sparepart berubah drastis dari waktu ke waktu, laporan bulan lalu ikut pakai harga sekarang. Cukup akurat buat skala 1 toko, upgrade ke Opsi (b) — snapshot `unit_cost` per baris checkout — kalau nanti kerasa perlu, lihat plan doc Task 3.2).
- `GET /dashboard/summary` — job aktif per status (real-time sekarang, bukan scoped tanggal), transaksi+omzet hari ini, invoice belum lunas. **Koreksi dari plan asli**: filter invoice belum lunas ditambah status `kurang_bayar` (plan cuma nyebut `belum_dibayar`/`dp`) — soalnya `kurang_bayar` itu status sticky pas invoice yang tadinya lunas nambah tagihan lagi (approve sparepart tambahan), tetap "belum lunas" secara bisnis.
- Semua endpoint laporan admin-only, pakai `invoices.created_at` sebagai satu sumber kebenaran rentang tanggal (bukan `transactions.created_at`).
- Laporan performa **kasir per shift** SENGAJA tidak di sini — itu udah dicover `GET /shifts/:id/report` di Siklus 4, sesuai scope plan doc.

**⚠️ Catatan:** skenario tes di plan doc lama nyebut `PATCH /payments/:id/verify` buat verifikasi pembayaran — endpoint itu **belum ada** di project ini (`PaymentsService.record()` masih apply langsung tanpa verifikasi, isu terbuka dari Siklus 5). Pas testing laporan nanti, skip langkah verifikasi itu, checkout+bayar biasa aja udah cukup buat data laporan muncul.

**Dependency:** Siklus 1, 3 (buat data laba-rugi — kalau `item_costs` masih kosong, `profit-loss` tetap jalan tapi semua HPP 0, gak error), 4 (buat performa kasir per shift, di luar scope siklus ini).

---

## Siklus 9 — Mode Offline Teknisi (Flutter + backend sync)

- [x] Plan — **sudah dibuat**: `2026-08-20-siklus-mode-offline-teknisi.md`
- [x] Implementasi — **SUDAH DIKIRIM** ke project (`src/technician-jobs/offline-sync.service.ts`+`dto/sync-*.dto.ts` baru, `technician-jobs.service/controller/module.ts` di-extend, `material-requests.module.ts` di-export, migration `20260823080000_offline_sync_log` — tabel BARU, aman langsung `prisma migrate dev` biasa karena belum pernah ada di DB manapun). Frontend tes manual buat idempotensi + deteksi konflik ditambah di tab Job Board. **Belum divalidasi end-to-end.**

**Requirement yang dicover:** Fitur Teknis #2 (cache data servis harian, aksi offline, sync otomatis, resolusi konflik pakai `updatedAt`).

**⚠️ Koreksi BESAR dari plan doc lama — vokabulernya salah total.** Plan awal ditulis mengira ada tabel checklist TETAP (`technician_job_checklist_items`, action `checklist_toggle`) dan model foto lama (`JobPhoto`, endpoint `POST /technician-jobs/:id/photos`) serta method `complete()`. **Tidak ada satupun dari itu di sistem ini** — semua sudah digantikan sistem checklist DINAMIS dari Siklus 5 revisi (`JobFinding`/`JobFindingPhoto`, endpoint `.../findings/:findingId/photos`, alur `submitForReview()` → `approveComplete()`). Plan doc lama itu ditulis SEBELUM Siklus 5 revisi terjadi, jadi otomatis basi. Implementasi ini dibangun ulang di atas vokabuler yang BENERAN ada sekarang:

**Yang dibangun:**
- `GET /technician-jobs/queue/today-bundle` — payload gemuk (job aktif milik teknisi yang login, lengkap dengan `findings`+foto+`materialRequests`, plus Top 20 sparepart terlaris 30 hari terakhir dari histori pengajuan material) buat precache harian sebelum berangkat. `technicianId` dari JWT, bukan query param.
- `POST /technician-jobs/sync-batch` — action type disesuaikan total: `finding_add` (bikin JobFinding baru), `material_add` (ajukan sparepart — **CATATAN PENTING**: gak langsung motong stok, cuma bikin `MaterialRequest` status `pending`; potong stok beneran terjadi belakangan pas admin approve + ditandai "dipakai", alur 2 langkah yang udah ada dari sebelumnya, bukan hal baru), `notes_update`, `submit_for_review` (pengganti `complete()` lama, transisi ke `menunggu_review` bukan langsung `selesai`). Semua idempoten via `clientActionId` (dicatat ke tabel baru `sync_action_log`), diproses satu-satu (1 action gagal gak nge-block action lain di batch yang sama), deteksi konflik pakai snapshot `updatedAt` job yang diambil SEKALI di awal batch (bukan di-refresh di tengah loop — biar 2 action buat job yang sama di batch yang sama gak saling nge-konflik gara-gara urutan proses internal).
- **Foto disederhanain dari plan asli**: draft lama punya alur foto "2 tahap" (`photo_upload_ref` sebagai action type terpisah di sync-batch). Ternyata gak perlu — endpoint upload foto temuan yang udah ada (`POST .../findings/:findingId/photos`) di-extend dikit terima `clientActionId` opsional buat dedup langsung di situ (row `job_finding_photos` cuma kebentuk 1x walau di-retry), jadi gak butuh action type tambahan di sync-batch buat foto sama sekali — lebih simpel dari rencana awal.
- `material_add` di sync-batch reuse `MaterialRequestsService.create()` yang sudah ada (bukan nulis ulang logic pricing) — modul itu di-export & diimport ke `TechnicianJobsModule`.

**Dependency:** Siklus 1, 2, 5 (wajib — semua method yang dibungkus di sini, `addFinding`/`addFindingPhoto`/`updateNotes`/`submitForReview`/`MaterialRequestsService.create`, adalah hasil Siklus 5 revisi, BUKAN Siklus 1 asli seperti anggapan plan lama).

---

## Siklus 10 — Retur / Refund Barang (digeser dari slot Siklus 5 lama)

- [x] Plan — **sudah dibuat** (isi lama dokumen `2026-08-20-siklus-retur-refund.md`, masih relevan)
- [ ] Implementasi

**Requirement yang dicover:** Kasir "Retur/refund barang" — dikonfirmasi tetap requirement asli (`requirementepos 2.md` §3 Kasir), cuma dipindah keluar dari slot "Siklus 5" karena checklist+review lebih mendesak (lihat catatan di Siklus 5 di atas).

**Yang perlu dibangun:**
- Tabel baru — `returns` + `return_items` (referensi ke `transaction_items`, alasan retur, siapa yang approve). **Koreksi dari draft lama**: pakai `@default(uuid())` bukan `cuid()`, dan `createdById` bukan `createdBy`, konsisten sama konvensi proyek ini.
- `POST /returns` — validasi item pernah dibeli di transaksi itu, validasi anti-double-return via `SUM(return_items.qty)` per `transactionItemId`, kembalikan stok lewat `StockLockingService.lockAndAdd` yang **sudah ada** (jangan bikin fallback inline baru kayak draft lama), catat `stock_movements` reason `retur`, sesuaikan `invoices.grand_total`/`total_paid` (negatif) kalau refund uang.

**Dependency:** Siklus 1 & 3.

---

## Ringkasan progress

| # | Siklus | Plan | Implementasi |
|---|--------|------|---------------|
| 1 | Penjualan + Instalasi + QR + Servis + Pelunasan | ✅ Sudah (rewrite as-built) | ✅ Sudah |
| 2 | Servis Masuk Mandiri | ✅ Sudah (rewrite as-built) | ✅ Sudah |
| 3 | Manajemen Stok | ✅ Sudah | ✅ Sudah |
| 4 | Kas & Shift Kasir | ✅ Sudah | ✅ Sudah |
| 5 | Checklist Temuan Servis + Review Admin | ✅ Sudah | ✅ Sudah dikirim — belum divalidasi end-to-end (perlu migrate+generate di project asli) |
| 6 | Voucher & Diskon Campaign | ✅ Sudah | ✅ Sudah dikirim — belum divalidasi end-to-end (perlu migrate+generate di project asli, cek isu migration drift dulu) |
| 7 | Reminder WA (worker) | ✅ Sudah | ⬜ Belum |
| 8 | Laporan & Dashboard | ✅ Sudah | ✅ Sudah dikirim — belum divalidasi end-to-end |
| 9 | Mode Offline Teknisi | ✅ Sudah | ✅ Sudah dikirim — belum divalidasi end-to-end (perlu migrate+generate; vokabuler action DIROMBAK dari plan lama yang basi, lihat catatan) |
| 10 | Retur / Refund (digeser dari slot 5 lama) | ✅ Sudah | ⬜ Belum |

Update tabel ini tiap kali satu siklus kelar plan-nya atau implementasinya, biar gampang liat progress keseluruhan proyek dalam satu pandangan.
