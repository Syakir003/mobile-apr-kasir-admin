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
   service_order_units, technician_jobs).
4. **Nomor HP = identitas member** (disimpan ternormalisasi via `normalize_phone`).
   Transaksi pelanggan baru otomatis membuat member; HP sama → member lama.
5. **Barcode unit** unik, format `ACUNIT-YYYYMMDD-NNNN`. Teknisi wajib scan &
   cocok sebelum memulai job (ditegakkan di RPC `update_technician_job_status`).
6. **Uang dalam rupiah bulat (integer)**, bukan desimal.

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

### Lainnya

- `generate_ac_unit_barcode(p_unit_id text)` → barcode untuk unit yang belum punya.
- `save_installation_package(payload)` → simpan paket pemasangan + item-nya.

---

## Model Data & Status

Sumber kebenaran kolom: file di `frontend/mobile/lib/data/models/*.dart` dan
`backend/supabase/migrations/..._init_schema.sql`.

Tabel inti: `users`, `members`, `member_ac_units`, `products`, `spareparts`,
`services`, `installation_packages(+_items)`, `transactions(+_items)`,
`invoices(+_items)`, `manual_payments`, `stock_movements`, `service_orders`,
`service_order_units`, `technician_jobs`, `audit_logs`.

Nilai status (text snake_case di DB):

| Entitas | Status |
|---------|--------|
| Unit AC | `menunggu_pemasangan`, `aktif`, `dalam_maintenance`, `rusak`, `nonaktif` |
| Job Teknisi | `menunggu_penugasan`, `assigned`, `sedang_dikerjakan`, `selesai`, `dibatalkan` |
| Order Service | `terjadwal`, `dalam_pengerjaan`, `selesai`, `dibatalkan` |
| Invoice | `belum_dibayar`, `dp`, `kurang_bayar`, `lunas`, `refund`, `batal` |
| Pembayaran (method) | `tunai`, `transfer`, `qris`, `ewallet` |

---

## Status Fitur (MVP)

| Fitur | Backend | Mobile |
|-------|:-------:|:------:|
| Login 3 peran | ✅ | ✅ |
| Master produk/sparepart/jasa/paket | ✅ | ✅ |
| Transaksi POS | ✅ | ✅ |
| Member otomatis + unit AC | ✅ | ✅ |
| Barcode unit (generate + scan) | ✅ | ✅ |
| Pembayaran manual + invoice/struk PDF | ✅ | ✅ |
| Order service + Job teknisi (assign/mulai/selesai) | ✅ | ✅ |
| Stok & mutasi stok | ✅ | ⏳ layar belum |
| Laporan / dashboard metrik | ✅ (data) | ✅ (tren + produk terlaris) |
| Foto bukti sebelum/sesudah | ❌ tabel belum | ❌ |
| Pengajuan sparepart/material + approval | ❌ tabel belum | ❌ |
| Notifikasi realtime (FCM) | ❌ | ❌ |

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
