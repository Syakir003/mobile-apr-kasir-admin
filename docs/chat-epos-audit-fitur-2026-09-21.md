# Ekspor Chat — Audit Struktur & Fitur E-POS AC (APR-POS)

**Tanggal:** 21–22 September 2026
**Project:** EPos APR
**Folder yang ditelaah:** `D:\E-POS Admin Kasir dan Teknisi Ayub Podo Rukun`

---

## 1. "lihat pada bagian direktori nest"

Isi direktori `Nest/` — monorepo longgar berisi dua project (backend NestJS + frontend Next.js), plus satu `package-lock.json` kosong di root.

### `Nest/epos-backend`

NestJS 11 + Prisma 7 (PostgreSQL via `@prisma/adapter-pg`), auth JWT/Passport, WebSocket (socket.io), `@nestjs/schedule`, firebase-admin, multer.

- 174 file `.ts` di `src/`, terbagi jadi ±28 modul domain: `auth`, `users`, `members`, `products`, `spareparts`, `services-catalog`, `installation-packages`, `item-costs`, `pos`, `invoices`, `payments`, `shifts`, `stock`, `service-orders`, `technician-jobs`, `material-requests`, `ac-units`, `vouchers`, `undian`, `reminders`, `wa-outbox`, `notifications`, `reports`, `dashboard`, `audit-logs`, `counters`, `app-config`, `realtime`, `common`, `prisma`.
- `prisma/schema.prisma`: **38 model** — inti transaksi (Transaction/TransactionItem, Invoice/InvoiceItem/InvoiceAdjustment, ManualPayment, CashierShift), servis & teknisi (ServiceOrder, ServiceOrderUnit, TechnicianJob, JobPhoto, JobFinding, MaterialRequest, SyncActionLog), stok (StockMovement), marketing (Voucher, Undian, ReminderSetting, WaReminderTemplate, WaOutbox), plus master data.
- `plan/` berisi 12 dokumen siklus (kas-shift kasir, manajemen stok, retur-refund, mode offline teknisi, voucher diskon, reminder WA, laporan-dashboard, checklist servis, rencana frontend Next.js), `docs/superpowers`, `prisma/seed.ts` + `seed-source`, `uploads/job-photos`, dan `frontend/` lama (HTML + `app.js` + `style.css` statis — sisa prototipe sebelum pindah ke Next.js).
- `.env` ada di folder ini.

### `Nest/epos-frontend-web`

Next.js 16.3.2 (App Router) + React 19, Tailwind v4, shadcn/Radix, TanStack Query, zustand, react-hook-form + zod, socket.io-client, html5-qrcode, sonner. Jalan di port 3001.

- Route group `(auth)/login` dan `(dashboard)` dengan halaman: `dashboard`, `pos`, `invoices/[id]/print`, `service-orders` (+ `intake`, `[id]/print`, `print-labels`), `teknisi` (`dashboard`, `jobs/[id]`, `queue`, `riwayat`), `stock` (+ `opname`), `master` (`produk`, `sparepart`, `jasa`, `paket`), `members/[id]`, `ac-units` (+ `scan`, `[id]`), `voucher`, `reminder-wa` (+ `riwayat`), `laporan`, `audit`, `pengguna`, `pengaturan`, `profil`.
- `src/app/api/`: route auth sendiri (`login`, `logout`, `session`, `change-password`, `socket-token`) dan `api/proxy/[...path]` — frontend mem-proxy request ke backend, tidak memanggil langsung dari browser. Ada juga `proxy.ts` dan `AGENTS.md`.

---

## 2. "kalo yang mobile?"

Aplikasi mobile **tidak ada di dalam `Nest/`** — letaknya di `frontend/mobile/`, dibuat dengan **Flutter (Dart)**.

### `frontend/mobile` — package `epos_ac` v0.1.0

"APR-POS - aplikasi kasir, admin, dan teknisi AC". Flutter SDK ^3.4.0, **125 file `.dart`**.

**Stack:**

- **State & routing**: flutter_riverpod + go_router
- **Data**: `supabase_flutter` **dan** `http` ke backend Nest — dua sumber data berdampingan
- **Perangkat**: `mobile_scanner` (scan QR unit AC), `image_picker` (foto job), `pdf` + `printing` (struk, invoice, surat jalan, label unit, laporan pekerjaan)
- **Notifikasi**: firebase_core + firebase_messaging + flutter_local_notifications
- **WA**: `url_launcher` — kirim reminder lewat tautan `wa.me` sebagai adapter manual, karena Cloud API Meta belum disetujui
- **Branding**: font Plus Jakarta Sans / Inter / JetBrains Mono di-bundle (style guide "Corporate Modernism"), launcher icon adaptif dari `favicon-512.png`

**Struktur `lib/`:** `core/` (api, router, supabase, theme, pdf, utils, 12 widget bersama), `data/` (19 model + 8 repository), dan `features/`: auth, dashboard, pos, transactions, jobs, members, master, stock, scan, reports, reminders, vouchers, undian, users, audit, notifications, profile. Ada `test/` dengan golden test preview (dashboard, form, shell, theme) beserta PNG hasilnya.

**Dua catatan penting:**

1. **Migrasi Supabase → Nest belum selesai.** 29 file masih mengimpor `supabase_flutter`, sementara hanya 12 file yang memakai `ApiClient` ke Nest.
2. **Base URL backend masih placeholder.** Di `lib/core/api/api_client.dart`: `const _cloudUrl = 'https://api.epos-ac.example'; // TODO: isi URL deploy Nest yang sebenarnya`. Dev bisa di-override `--dart-define=NEST_API_URL=http://10.0.2.2:3000` (emulator) atau IP LAN (HP fisik).

**Total tiga klien:** Flutter mobile (`frontend/mobile`), Next.js web baru (`Nest/epos-frontend-web`), dan prototipe HTML statis lama (`Nest/epos-backend/frontend`).

---

## 3. "rangkumkan fiturnya"

**Peran**: Admin, Kasir, Teknisi — hak akses dibatasi per area.

### Inti transaksi

- **POS / kasir** — `POST /pos/checkout`: keranjang berisi produk, sparepart, jasa, atau paket instalasi; diskon, pajak (%), ongkos kirim, catatan, kode voucher. Pelanggan baru otomatis jadi member (nomor HP = identitas, dinormalisasi). Checkout langsung memotong stok + mencatat `stock_movements`.
- **Instalasi otomatis** — kalau item produk ditandai sebagai pemasangan, checkout sekalian membuat unit AC member (+barcode), service order, dan job teknisi.
- **Invoice & pembayaran** — invoice bernomor, pembayaran manual bertahap (tunai/transfer/QRIS/e-wallet), status lunas dihitung dari total bayar, kembalian tunai dicatat. Kirim invoice via WhatsApp, cetak PDF (struk, invoice, surat jalan).
- **Shift kasir** — buka shift, shift berjalan, tutup shift, laporan shift. *Ada di Nest, belum ada di Supabase.*
- **Voucher & undian** — voucher ad-hoc (buat/batal, dipakai saat checkout) dan undian: buat, daftar peserta, tarik pemenang, batal.

### Servis & teknisi

- **Service order** — dari checkout instalasi, atau intake mandiri (`POST /service-orders/intake`). Cetak lembar order + label unit.
- **Unit AC & barcode** — barcode unik `ACUNIT-YYYYMMDD-NNNN`, bisa di-lookup/scan (`mobile_scanner` di mobile, `html5-qrcode` di web), punya riwayat servis sendiri.
- **Job teknisi** — antrean job, penugasan teknisi, mulai job (**wajib scan barcode cocok + foto SEBELUM**), foto sesudah, catatan, temuan/findings berfoto dengan kategori masalah.
- **Alur review** — teknisi `submit-for-review` → admin `approve-complete` atau `send-back` (revisi), plus `cancel`.
- **Permintaan material** — teknisi mengajukan sparepart di lapangan, admin approve/tolak, lalu ditandai terpakai (memotong stok).
- **Mode offline** — `queue/today-bundle` (bundel kerja sehari) + `sync-batch` dengan `SyncActionLog`.
- **Status bayar tidak memblokir** — job boleh dimulai walau invoice belum lunas; hanya badge sisa tagihan. Yang menahan tombol "Mulai" adalah foto sebelum + scan barcode.

### Data & stok

- **Master data** — produk, sparepart, jasa, paket instalasi (beserta itemnya), dan `item-costs` (HPP per item).
- **Member** — pencarian, detail, daftar unit AC, opt-out WA.
- **Stok** — barang masuk, stock opname, riwayat pergerakan stok.

### Pengingat & komunikasi

- **Reminder servis berkala** — `next_service_date` terisi otomatis saat job selesai; penjadwal harian memanen H-3 dan H+7 ke antrean `wa_outbox`.
- **Pengiriman WA manual** — admin buka antrean, tekan kirim → membuka `wa.me`, lalu tandai terkirim / batal. Ada riwayat kiriman.
- **Template pesan** — redaksi pengingat bisa diedit admin, plus pengaturan interval.
- **Notifikasi** — push FCM (device token) + notifikasi in-app dengan hitungan belum dibaca.

### Manajemen & pelaporan

- **Dashboard** — ringkasan metrik, tren penjualan, transaksi terbaru.
- **Laporan** — penjualan, servis, dan laba-rugi.
- **Pengguna** — buat user, atur role, aktif/nonaktif, reset password; user nonaktif kehilangan klaim role di token berikutnya.
- **Audit log** — semua aksi tercatat, hanya admin yang boleh membaca, tidak ada jalur tulis dari client.
- **Pengaturan aplikasi** — `app-config` key-value dan profil pengguna.

### Catatan status

`plan.md` (17 Sep) menetapkan Supabase sebagai source of truth sementara dan memporting 4 fitur Nest ke migrasi Supabase: checklist servis/review, shift kasir, offline sync log, dan field diskon batch POS. Dua hal sengaja **tidak** diporting: rework `item_costs` multi-batch (breaking) dan desain WA auto-send Fonnte milik Nest (Supabase tetap `wa_outbox` + wa.me manual).

---

## 4. "setauku detail fitur yang web sama mobile ada yang berbeda tolong cek"

Terkonfirmasi — bedanya cukup banyak, dan beberapa bukan sekadar beda tampilan tapi beda model data.

### Ada di mobile, tidak ada di web

| Fitur | Mobile | Web |
|---|---|---|
| **Undian** | Lengkap: daftar, buat, kelola peserta, tarik pemenang, batal (`/undian`) | **Tidak ada sama sekali.** Halaman voucher cuma membaca `source: 'undian'` sebagai label asal voucher. Endpoint `/undian` di Nest menganggur |
| **Push notification** | FCM + `flutter_local_notifications` + registrasi device token | Tidak ada push. Hanya socket.io + polling 60 detik sebagai jaring pengaman |
| **Halaman notifikasi** | Layar `/notifications` sendiri | Cuma dropdown lonceng di header |
| **PDF surat jalan** | `delivery_note_pdf.dart` | Tidak ada |
| **PDF laporan pekerjaan** | `job_report_pdf.dart` | Tidak ada (web hanya cetak invoice, order servis, label unit) |

### Ada di web, tidak ada di mobile

| Fitur | Web | Mobile |
|---|---|---|
| **Checklist temuan (JobFinding)** | UI temuan + foto sebelum/sesudah per temuan, lalu ajukan review | **Tidak ada UI temuan.** Masih model lama foto flat per job |
| **Alur review job** | `submit-for-review` → `approve-complete` / `send-back`, tombol lengkap di detail job | Kode aksinya ada, tapi praktis tidak jalan (lihat di bawah) |
| **Stok batch / HPP multi-batch** | Dialog "Lihat Batch", stok masuk per batch, POS baca batch | Masih `sell_price` + `stock` flat, satu `item_cost` per item |
| **Opname stok** | Halaman khusus: tab opname + tab riwayat mutasi | Hanya `stock_adjust_screen` (penyesuaian manual biasa) |
| **Pengaturan aplikasi** | Halaman `/pengaturan` untuk 4 key AppConfig | Tidak ada |
| **Opt-out WA member** | Ada toggle | Tidak ada |
| **Kirim invoice via WA** | `POST /invoices/:id/send-whatsapp` | Tidak ada |
| **Ruang kerja teknisi** | Terpisah: dashboard, antrean, riwayat | Hanya satu daftar `/jobs` |

### Kerusakan nyata yang sudah terdokumentasi di kode

Di `lib/features/jobs/job_providers.dart` ada komentar panjang yang menyebut dua gap ini sebagai kesenjangan arsitektur, bukan bug migrasi:

1. **Teknisi mobile tidak bisa menyelesaikan job.** Aksi `complete` dipetakan ke `submit-for-review`, sementara Nest mewajibkan minimal 1 temuan berfoto. Karena mobile tidak punya UI temuan, endpoint ini **selalu ditolak 400 "Minimal 1 temuan masalah harus diisi..."** untuk job apa pun yang dikerjakan lewat UI sekarang.
2. **Mulai job tanpa barcode patah.** Nest selalu mewajibkan `scannedBarcode` cocok, walau unitnya tidak punya barcode. Jalur "job tanpa unit: mulai langsung" di `job_detail_screen.dart` jadi ditolak.

Catatan di kode itu sengaja tidak menambalnya, dan menyerahkan ke keputusan produk: mobile dibuatkan UI temuan, atau `submit-for-review` dikasih jalur kompatibel model lama.

### Ada di backend, tidak dipakai keduanya

- **Shift kasir** — `/shifts` (buka, berjalan, tutup, laporan) sudah jadi di Nest, tapi nol halaman di web maupun mobile.
- **Mode offline teknisi** — `queue/today-bundle` dan `sync-batch` tidak dipanggil klien mana pun.

### Beda fondasi

Akar dari sebagian besar selisih di atas: web sudah sepenuhnya jalan di atas Nest (lewat proxy Next, realtime pakai socket.io), sedangkan mobile mayoritas masih query Supabase langsung — 16 pemakaian `.stream()` tersebar di 12 file repository/provider. Yang sudah pindah ke Nest di mobile baru sebagian, dan base URL-nya pun masih `https://api.epos-ac.example`. Jadi web mencerminkan skema terbaru (checklist+review, batch), mobile mencerminkan skema Supabase lama — persis yang mau diselaraskan lewat `plan.md`, walau 4 migrasi di situ belum menyentuh UI mobile-nya.

---

## Lampiran — Referensi teknis yang dikutip

**Endpoint backend Nest (per controller):**

| Controller | Route |
|---|---|
| ac-units | `POST /ac-units`, `GET /ac-units/lookup/:barcodeValue`, `GET/PATCH /ac-units/:id` |
| app-config | `GET /app-config`, `PUT /app-config/:key` |
| audit-logs | `GET /audit-logs` |
| auth | `POST /auth/login`, `GET /auth/me`, `PATCH /auth/me/password` |
| dashboard | `GET /dashboard/summary` |
| installation-packages | `GET`, `GET /:id`, `POST`, `PATCH /:id` |
| invoices | `GET /invoices`, `GET /invoices/:id`, `POST /invoices/:id/send-whatsapp` |
| item-costs | `GET`, `GET /:kind/:refId`, `PUT /:kind/:refId` |
| material-requests | `POST /technician-jobs/:jobId/materials`, `PATCH /material-requests/:id/decide`, `PATCH /material-requests/:id/mark-used` |
| members | `GET /members/search`, `POST`, `GET`, `GET /:id`, `PATCH /:id/wa-opt-out`, `PATCH /:id` |
| notifications | `POST/DELETE /device-tokens`, `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/read` |
| payments | `POST /invoices/:id/payments` |
| pos | `POST /pos/checkout` |
| products | `POST`, `GET`, `GET /:id`, `PATCH /:id` |
| reminders | `GET/PUT /reminders/settings`, `GET/PUT /reminders/templates` |
| reports | `GET /reports/sales`, `/service`, `/profit-loss` |
| service-orders | `POST /service-orders/intake`, `GET`, `GET /:id` |
| services | `POST`, `GET`, `PATCH /:id` |
| shifts | `POST /shifts/open`, `GET /shifts/current`, `POST /shifts/:id/close`, `GET /shifts/:id/report` |
| spareparts | `POST`, `GET`, `GET /search`, `PATCH /:id` |
| stock | `POST /stock/in`, `POST /stock/opname`, `GET /stock/movements` |
| technician-jobs | `GET /queue`, `GET /queue/today-bundle`, `POST /sync-batch`, `GET`, `GET /history`, `GET /categories/search`, `POST /categories`, `GET /:id`, `PATCH /:id/assign`, `/start`, `POST /:id/findings`, `/findings/:findingId/photos`, `/:id/photos`, `PATCH /:id/notes`, `/submit-for-review`, `/approve-complete`, `/send-back`, `/cancel` |
| undian | `GET`, `GET /:id`, `POST`, `PUT /:id/participants`, `POST /:id/draw`, `POST /:id/cancel` |
| users | `POST`, `GET`, `GET /:id`, `GET /technicians`, `PATCH /:id/toggle-active`, `/password`, `/:id` |
| vouchers | `POST`, `GET`, `POST /:id/cancel` |
| wa-outbox | `GET`, `GET /history`, `POST /:id/mark-sent`, `POST /:id/cancel` |

**Menu web per role (`nav-config.ts`):**

- **admin** — Dashboard, Kasir (POS), Riwayat Transaksi, Servis & Teknisi, Servis Mandiri, Member, Master Data, Voucher, Opname Stok, Pengingat WA, Riwayat WA, Pengguna, Log Audit, Laporan, Pengaturan, Profil
- **kasir** — Kasir (POS), Riwayat Transaksi, Servis Mandiri, Member, Profil
- **teknisi** — Dashboard, Job, Scan Unit, Riwayat, Profil

**Menu mobile (`adaptive_scaffold.dart`):**

- **umum** — Dashboard `/`, Transaksi `/pos`, Riwayat `/transactions`, Scan `/scan`, Order `/orders`, Job `/jobs`, Profil `/profile`, Pengingat `/pengingat`, Voucher `/voucher`, Undian `/undian`
- **admin tambahan** — Produk, Sparepart, Jasa, Paket, Member, Stok, Laporan, Akun, Audit
