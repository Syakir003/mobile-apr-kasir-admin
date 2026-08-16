# E-POS AC Realtime

Sistem operasional bisnis AC: **penjualan unit AC, sparepart/material, dan jasa
teknisi** (pasang, cuci, service, maintenance) dengan data realtime. Setiap
pelanggan otomatis jadi member, setiap unit AC punya barcode unik, teknisi scan
sebelum bekerja, dan pembayaran dicatat manual.

- **Backend**: Supabase (Postgres + Auth + Realtime), migrasi SQL di `backend/supabase/`.
- **Frontend mobile**: Flutter (`frontend/mobile/`) — Android/iOS/Web.
- **Frontend web**: Next.js (`frontend/web/`).
- **Peran**: Admin, Kasir, Teknisi.

> **Untuk yang mengerjakan versi web:** frontend web cukup dibangun di atas
> backend Supabase yang **sama** (proyek Supabase, tabel, dan RPC yang sama).
> Bagian terpenting bagi Anda: **[Auth & Peran](#auth--peran)**,
> **[Kontrak RPC](#kontrak-rpc)**, dan **[Aturan Penting](#aturan-penting)** —
> semua penulisan data lewat RPC, jangan `insert/update` tabel langsung.

---

## Struktur Repositori

```
backend/
  supabase/migrations/   Skema Postgres, RLS, RPC, realtime (sumber kebenaran)
frontend/
  mobile/                Aplikasi Flutter (Android/iOS/Web)
  web/                   Aplikasi Next.js (lihat frontend/web/README.md)
functions/               Sisa Cloud Functions era Firebase (legacy, tak dipakai)
docs/                    Dokumen pendukung
docs/Flow-Sistem-EPOS-AC.md   Diagram alur sistem (dirender otomatis di GitHub)
Dokumen_Fitur_EPOS_AC_Mobile_Realtime.docx   Spesifikasi fitur lengkap (MVP)
```

> **Backend vs frontend** terpisah rapi: `backend/supabase/` (satu backend) dipakai
> bersama oleh `frontend/mobile/` (Flutter) dan `frontend/web/` (Next.js). Perintah
> Supabase CLI dijalankan dari dalam folder `backend/`.

Migrasi backend (urut):

| File | Isi |
|------|-----|
| `..._init_schema.sql` | Semua tabel + enum |
| `..._auth_role_hook.sql` | Klaim JWT `user_role`, helper `jwt_role()` |
| `..._rls_policies.sql` | Row Level Security per peran |
| `..._realtime.sql` | Tabel yang di-stream realtime |
| `..._pos_functions.sql` | RPC `checkout_transaction`, `record_payment`, dll |
| `..._grants.sql` | GRANT tabel ke role `authenticated` |
| `..._technician_jobs.sql` | RPC job teknisi + realtime order/job |
| `..._job_photos.sql` | Foto bukti sebelum/sesudah |
| `..._material_requests.sql` | Pengajuan material + approval |
| `..._notifications.sql` | Notifikasi in-app |
| `..._device_tokens.sql` / `..._push_trigger.sql` | Token perangkat + trigger push |
| `..._service_order_manual.sql` | RPC `create_service_order` (order manual) |
| `..._payment_approval_photo_rules.sql` | Rule bayar/approval/foto (8.3–8.5) |
| `..._checkout_service_units.sql` | Jasa pada unit AC member lewat checkout |
| `..._stock_manual.sql` | RPC `adjust_stock` (barang masuk & penyesuaian) |
| `..._user_management.sql` | RPC `update_user_account` |
| `..._audit_read_payment_info.sql` | Baca `audit_logs` (admin) + `job_payment_info` |
| `..._service_reminders.sql` | Skema pengingat servis + antrean `wa_outbox` |
| `..._schedule_on_job_complete.sql` | Isi `next_service_date` & antre pesan saat job selesai |
| `..._reminder_scheduler.sql` | `pg_cron` harian: panen jadwal H-3 & H+7 |
| `..._reminder_rpc.sql` | RPC antrean WA + pengaturan interval |

---

## Menjalankan Backend

Butuh [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
cd backend                   # folder tempat berisi supabase/

# lokal
supabase start
supabase db reset            # terapkan semua migrasi + seed

# ke proyek cloud
supabase link --project-ref <ref>
supabase db push             # terapkan migrasi yang belum ada
```

Aktifkan **custom access token hook** (agar role masuk JWT) di `config.toml`:

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

Env yang dibutuhkan frontend: `SUPABASE_URL` dan `SUPABASE_ANON_KEY`
(publishable key).

---

## Auth & Peran

- Login pakai **Supabase Auth** (email/password).
- Role bukan di JWT bawaan — di-inject oleh hook `custom_access_token_hook` dari
  tabel `public.users` ke klaim **`user_role`**. Baca dengan `jwt_role()` di SQL,
  atau `auth.jwt()['user_role']` / decode JWT di client.
- **User nonaktif** (`users.active = false`) kehilangan klaim role pada token
  berikutnya → client wajib menolak sesi tanpa role.
- Baris `public.users` dibuat otomatis dari `auth.users` (trigger
  `handle_new_user`). Set `role` & `display_name` di `public.users`.

Ringkasan hak akses (detail lengkap di dokumen fitur §4.4):

| Area | Admin | Kasir | Teknisi |
|------|:-----:|:-----:|:-------:|
| Master (produk/sparepart/jasa/paket) | ✅ | — | — |
| Transaksi POS & pembayaran | ✅ | ✅ | — |
| Member & unit AC | ✅ | terbatas | — |
| Order service & tugaskan teknisi | ✅ | terbatas | — |
| Job teknisi | semua | lihat | miliknya |
| Scan barcode & kerjakan job | ✅ | — | ✅ |

---

## Aturan Penting

1. **Semua penulisan data lewat RPC** `SECURITY DEFINER`, bukan `insert/update`
   tabel dari client. Tabel finansial & operasional (transactions, invoices,
   payments, stock, orders, jobs) hanya bisa ditulis via RPC. Client hanya
   `select` (dibatasi RLS) + `insert/update` master/member/unit.
2. **RLS + GRANT**: RLS membatasi baris, tapi role `authenticated` tetap butuh
   `GRANT` tabel (lihat `..._grants.sql`) — kalau tidak, query gagal
   "permission denied" sebelum RLS dievaluasi.
3. **Realtime**: hanya tabel yang terdaftar di publication `supabase_realtime`
   yang bisa `.stream()`/subscribe (users, products, spareparts, services,
   packages, members, member_ac_units, invoices, manual_payments, service_orders,
   service_order_units, technician_jobs, wa_outbox).
4. **Nomor HP = identitas member** (disimpan ternormalisasi via `normalize_phone`).
   Transaksi pelanggan baru otomatis membuat member; HP sama → member lama.
5. **Barcode unit** unik, format `ACUNIT-YYYYMMDD-NNNN`. Teknisi wajib scan &
   cocok sebelum memulai job (ditegakkan di RPC `update_technician_job_status`).
6. **Uang dalam rupiah bulat (integer)**, bukan desimal.
7. **Status bayar = peringatan, bukan blokir.** Job tetap boleh dimulai walau
   invoice belum lunas — jasa AC lazim ditagih setelah pekerjaan selesai.
   Aplikasi menampilkan badge sisa tagihan (`job_payment_info`); yang benar-benar
   menahan tombol "Mulai" hanya foto SEBELUM + scan barcode.
8. **Audit log tertutup kecuali admin.** Semua RPC menulis ke `audit_logs`;
   yang boleh membacanya hanya admin (RLS), dan tidak ada jalur tulis dari client.

---

## Kontrak RPC

Panggil via `supabase.rpc('<nama>', { payload })`. Semua mengembalikan JSON.
Error dilempar sebagai exception dengan pesan Indonesia.

### `checkout_transaction(payload)` — buat transaksi + invoice (admin/kasir)

```jsonc
// payload
{
  "customer": { "name": "Budi", "phone": "0811...", "address": "Jl. Mawar" },
  "items": [
    { "kind": "product", "refId": "<uuid>", "qty": 1 },
    { "kind": "service", "refId": "<uuid>", "qty": 1 }
  ],
  "discount": 0,            // rupiah bulat
  "taxPercent": 11,         // 0..100
  "transportFee": 0,        // rupiah bulat
  "notes": "",
  // opsional — pemasangan unit AC baru; itemIndex menunjuk index item product
  "installations": [
    { "itemIndex": 0, "roomLocation": "Kamar Utama", "technicianId": "<uuid|null>" }
  ]
}
// return
{ "invoiceId": "<uuid>", "invoiceNumber": "INV-...", "memberId": "<uuid>", "transactionId": "<uuid>" }
```

Efek samping: buat/temukan member, kurangi stok + catat `stock_movements`, dan
bila ada `installations` → buat `member_ac_units` (+ barcode), `service_orders`,
`service_order_units`, dan `technician_jobs`.

### `record_payment(payload)` — catat pembayaran manual (admin/kasir)

```jsonc
{ "invoiceId": "<uuid>", "method": "tunai", "amount": 50000, "note": "" }
// method: 'tunai' | 'transfer' | 'qris' | 'ewallet'  ·  amount: int > 0
// return: { "status": "lunas", "totalPaid": 50000 }
```

Status invoice dihitung otomatis (total invoice − total bayar).

### `assign_technician_job(payload)` — tugaskan teknisi (admin/kasir)

```jsonc
{ "jobId": "<uuid>", "technicianId": "<uuid|''>" }  // '' = lepas penugasan
// return: { "ok": true }
```

### `update_technician_job_status(payload)` — transisi job (teknisi/admin)

```jsonc
{ "jobId": "<uuid>", "action": "start", "scannedBarcode": "ACUNIT-...", "notes": "" }
// action: 'start' | 'complete' | 'cancel'
// return: { "ok": true, "status": "sedang_dikerjakan" }
```

- `start`: job harus `assigned`; **wajib** `scannedBarcode` cocok unit (rule 8.2).
- `complete`: job harus `sedang_dikerjakan`; update status unit AC + order.
- `cancel`: hanya admin; job belum selesai.
- Teknisi hanya boleh mengubah job miliknya.

### `adjust_stock(payload)` — barang masuk / penyesuaian stok (admin)

```jsonc
{
  "itemKind": "product",   // 'product' | 'sparepart'
  "refId": "<uuid>",
  "qtyChange": 10,          // <> 0; positif = masuk, negatif = keluar
  "reason": "pembelian",   // 'pembelian' | 'koreksi' | 'retur' | 'rusak'
  "note": ""
}
// return: { "ok": true, "stock": 24, "movementId": "<uuid>" }
```

Alasan otomatis milik sistem (`penjualan`, `pemakaian`) ditolak — mutasi manual
tidak boleh menyamar sebagai penjualan. Stok tidak boleh jadi negatif.

### `update_user_account(payload)` — kelola akun (admin)

```jsonc
{ "userId": "<uuid>", "role": "kasir", "active": true, "displayName": "Budi" }
// field yang tidak dikirim = tidak diubah
// return: { "ok": true, "userId": "...", "role": "...", "active": true, "displayName": "..." }
```

Penjaga: **admin tidak bisa menurunkan/menonaktifkan dirinya sendiri**. Karena
pemanggil wajib admin aktif dan tak boleh menyentuh akunnya sendiri, jumlah admin
aktif tidak pernah bisa turun ke nol. **Membuat akun baru** tidak lewat RPC —
lihat Edge Function di bawah.

### `job_payment_info(payload)` — status bayar di balik satu job

```jsonc
{ "jobId": "<uuid>" }
// return: { "ok": true, "hasInvoice": true, "invoiceId": "...", "number": "INV-...",
//           "status": "dp", "grandTotal": 500000, "totalPaid": 200000, "outstanding": 300000 }
```

Dipakai untuk **peringatan** (badge) di detail job — bukan blokir. Teknisi hanya
boleh menanyakan job miliknya; `hasInvoice: false` untuk order manual yang belum
ditagih.

### Pengingat servis (antrean WhatsApp)

| RPC | Peran | Payload → efek |
|-----|-------|----------------|
| `mark_wa_sent` | admin, kasir | `{id}` → status `terkirim`, catat `sent_by`/`sent_at`/`provider` |
| `cancel_wa_message` | admin, kasir | `{id, reason?}` → status `dibatalkan` |
| `save_reminder_settings` | admin | `{jobType, intervalDays, active}` → default siklus per jenis job |
| `set_unit_service_interval` | admin | `{unitId, intervalDays?}` → override per unit; tanpa `intervalDays` = kembali ke default |
| `set_member_wa_opt_out` | admin, kasir | `{memberId, optOut}` → pelanggan berhenti dikirimi pengingat |

`save_reminder_settings` **tidak** menggeser `next_service_date` unit yang sudah
dijadwalkan — interval baru berlaku mulai servis berikutnya.

### Lainnya

- `generate_ac_unit_barcode(p_unit_id text)` → barcode untuk unit yang belum punya.
- `save_installation_package(payload)` → simpan paket pemasangan + item-nya.

---

## Edge Functions

Di `backend/supabase/functions/`. Deploy: `supabase functions deploy <nama>`.

| Fungsi | Kegunaan | Secret |
|--------|----------|--------|
| `send-push` | Kirim FCM push saat baris `notifications` dibuat | `FCM_SERVICE_ACCOUNT`, `PUSH_WEBHOOK_SECRET` |
| `send-wa` | Adapter kirim WhatsApp (kerangka; lihat "Pengingat Servis") | `WA_WEBHOOK_SECRET`, `WA_TOKEN`, `WA_PHONE_NUMBER_ID` |
| `admin-users` | Buat akun baru & reset password (butuh `service_role`) | — (pakai env bawaan runtime) |

`admin-users` menerima `{ action: "create", email, password, displayName, role }`
atau `{ action: "resetPassword", userId, password }`. Pemanggil wajib login dan
perannya dicek **ke tabel** `public.users` (bukan sekadar klaim JWT), sehingga
admin yang baru dinonaktifkan langsung kehilangan akses.

---

## Pengingat Servis via WhatsApp

Setiap job **cuci** atau **maintenance** yang selesai mengisi
`member_ac_units.next_service_date` (kolomnya ada sejak migrasi pertama tapi
dulu tidak pernah diisi). Dari situ pesan tidak langsung dikirim, melainkan
diantre di tabel `wa_outbox`:

| Kapan | `kind` | Isi |
|-------|--------|-----|
| Job selesai | `selesai_servis` | Konfirmasi pekerjaan + tanggal servis berikutnya |
| H-3 sebelum jatuh tempo | `reminder_h3` | Ajakan menjadwalkan teknisi |
| H+7 setelah lewat | `reminder_h7` | Pengingat terakhir bila belum memesan |

Urutan penentuan interval (yang pertama ketemu menang):
`member_ac_units.service_interval_days` (override per unit) →
`reminder_settings.interval_days` (default per jenis job, diatur admin dari
`/pengingat/pengaturan`) → tidak dijadwalkan sama sekali.

Panen jadwal harian dilakukan `pg_cron` (`enqueue_service_reminders()`, 02:00
UTC = 09:00 WIB). Aman dijalankan berkali-kali: `wa_outbox.dedupe_key` unik per
(pelanggan, jenis, tanggal jatuh tempo), dan unit yang sudah punya job berjalan
otomatis berhenti diingatkan.

> `pg_cron` harus diaktifkan lebih dulu di **Dashboard Supabase → Database →
> Extensions**; tanpa itu `supabase db push` gagal di migrasi scheduler.

### Cara kirim sekarang: adapter `manual`

Admin/kasir membuka **Pengingat** (mobile `/pengingat`, web `/pengingat`), menekan
satu tombol, dan WhatsApp terbuka dengan pesan sudah terisi penuh — tinggal Send.
Nol biaya dan nomor tidak berisiko diblokir, sekaligus kesempatan menguji redaksi
pesan ke pelanggan asli. Status baru ditandai terkirim **setelah** WhatsApp
benar-benar terbuka.

### Naik ke WhatsApp Cloud API (nanti)

Urutannya, dan **tidak ada migrasi skema maupun perubahan UI** di langkah mana pun:

1. Verifikasi bisnis di Meta Business Manager.
2. Daftarkan nomor khusus WhatsApp Business (nomor yang dipakai di sini tidak bisa
   lagi dipakai di aplikasi WhatsApp biasa).
3. Ajukan 3 template kategori **Utility** — salin redaksinya persis dari
   `build_wa_body()` di migrasi `..._service_reminders.sql`.
4. `supabase secrets set WA_TOKEN=… WA_PHONE_NUMBER_ID=… WA_WEBHOOK_SECRET=…`
   lalu `supabase functions deploy send-wa`.
5. Isi `app_config`: `wa_adapter='cloud_api'`, `wa_function_url`, `wa_secret`.
6. Pasang trigger `pg_net` dari `wa_outbox` ke `send-wa` (polanya sama dengan
   `enqueue_push()` untuk FCM).

**Biayanya**: template Utility Indonesia sekitar Rp 340/pesan, tanpa kuota gratis
— jatah 1.000 percakapan/bulan sudah dihapus Meta per 1 Juli 2025. Mulai
1 Oktober 2026 template utility di dalam service window pun ikut ditagih.

---

## Model Data & Status

Sumber kebenaran kolom: file di `frontend/mobile/lib/data/models/*.dart` dan
`backend/supabase/migrations/..._init_schema.sql`.

Tabel inti: `users`, `members`, `member_ac_units`, `products`, `spareparts`,
`services`, `installation_packages(+_items)`, `transactions(+_items)`,
`invoices(+_items)`, `manual_payments`, `stock_movements`, `service_orders`,
`service_order_units`, `technician_jobs`, `audit_logs`, `reminder_settings`,
`wa_outbox`.

Nilai status (text snake_case di DB):

| Entitas | Status |
|---------|--------|
| Unit AC | `menunggu_pemasangan`, `aktif`, `dalam_maintenance`, `rusak`, `nonaktif` |
| Job Teknisi | `menunggu_penugasan`, `assigned`, `sedang_dikerjakan`, `selesai`, `dibatalkan` |
| Order Service | `terjadwal`, `dalam_pengerjaan`, `selesai`, `dibatalkan` |
| Invoice | `belum_dibayar`, `dp`, `kurang_bayar`, `lunas`, `refund`, `batal` |
| Pembayaran (method) | `tunai`, `transfer`, `qris`, `ewallet` |
| Antrean WA (`wa_outbox.status`) | `pending`, `terkirim`, `gagal`, `dibatalkan` |
| Jenis pesan WA (`wa_outbox.kind`) | `selesai_servis`, `reminder_h3`, `reminder_h7` |

---

## Status Fitur (MVP)

| Fitur | Backend | Mobile |
|-------|:-------:|:------:|
| Login 3 peran | ✅ | ✅ |
| Master produk/sparepart/jasa/paket | ✅ | ✅ |
| Transaksi POS | ✅ | ✅ |
| Member otomatis + unit AC | ✅ | ✅ |
| Barcode unit (generate + scan) | ✅ | ✅ |
| Histori service per unit AC | ✅ (data) | ✅ (`/units/:id/history`) |
| Pembayaran manual + invoice/struk PDF | ✅ | ✅ |
| Order service + Job teknisi (assign/mulai/selesai) | ✅ | ✅ |
| Stok & mutasi stok | ✅ | ✅ |
| Laporan / dashboard metrik | ✅ (data) | ✅ (tren + produk terlaris) |
| Foto bukti sebelum/sesudah | ✅ | ✅ (upload kamera/galeri di Job) |
| Pengajuan sparepart/material + approval | ✅ | ✅ (ajukan + approve/tolak di Job) |
| Notifikasi realtime (in-app) | ✅ | ✅ (Supabase Realtime + FCM push) |
| Pengingat servis via WhatsApp | ✅ (jadwal + antrean + scheduler) | ✅ (`/pengingat`, kirim manual wa.me) |
| Stok masuk & penyesuaian manual | ✅ (`adjust_stock`) | ✅ (`/stok/adjust`) |
| Manajemen akun (buat/peran/nonaktif) | ✅ (RPC + Edge Function) | ✅ (`/users`) |
| Riwayat audit | ✅ (baca admin) | ✅ (`/audit`) |

Spesifikasi lengkap: **`Dokumen_Fitur_EPOS_AC_Mobile_Realtime.docx`**.

---

## Tema Visual (samakan di web)

Teal + slate (Tailwind). Utama:

| Peran warna | Hex |
|-------------|-----|
| Primary Teal (interaktif) | `#0D9488` |
| Dark Teal (aksen/grafik) | `#0F766E` |
| Soft Teal (bg lembut) | `#CCFBF1` |
| Background | `#F8FAFC` |
| Teks utama | `#0F172A` |
| Teks sekunder | `#64748B` |
| Border | `#E2E8F0` |
| Danger / Warning / Success | `#DC2626` / `#F59E0B` / `#16A34A` |

Definisi lengkap: `frontend/mobile/lib/core/theme/app_theme.dart`.

---

## Menjalankan Frontend

### Mobile (Flutter)

```bash
cd frontend/mobile
flutter pub get
flutter analyze
flutter test
flutter run            # -d chrome untuk web
```

Arsitektur: **Riverpod** (state) + **go_router** (navigasi, guard per-peran di
`core/router/redirect.dart`) + **repository** (baca Supabase) + **RPC caller
provider** (tulis).

### Web (Next.js)

```bash
cd frontend/web
cp .env.local.example .env.local     # isi URL + anon key Supabase
npm install
npm run dev                          # http://localhost:3000
```

Detail: `frontend/web/README.md`. Pola sama seperti mobile — baca via `select`,
tulis via `lib/rpc.ts`, role dari klaim JWT.
