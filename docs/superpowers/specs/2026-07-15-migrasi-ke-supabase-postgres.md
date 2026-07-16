# Rencana Migrasi: Firebase → PostgreSQL (Supabase)

> Status: **DIKERJAKAN** — langkah §8.1–8.6 ditulis (2026-07-15) & **backend
> diverifikasi di Supabase lokal (2026-07-16)**. Migrasi/skema/RPC/RLS lulus;
> satu bug grant ditemukan & diperbaiki (migrasi 0006). Sisi Flutter belum
> diverifikasi (butuh Flutter SDK; `flutter test` di mesin dev).
> Lihat "Log progres" di akhir dokumen.
> Konteks: E-POS AC sudah Fase 4/8 di atas Firebase (Firestore + Cloud
> Functions + Auth). User memutuskan pindah ke SQL/PostgreSQL, dengan
> pendorong utama: **aplikasi mobile (Flutter) + aplikasi web perlu berbagi
> satu backend.**

## 1. Ringkasan keputusan

Rekomendasi: pindah ke **Supabase** (PostgreSQL asli + Auth + Realtime +
Storage + Row Level Security). Alasan dibanding "Postgres murni + backend
sendiri":

- Paling dekat dengan pola kerja Firebase sekarang → migrasi paling halus,
  konsep baru paling sedikit.
- Client (mobile & web) tetap bisa konek relatif langsung dengan aman berkat
  **RLS** (analog Firestore Security Rules) — tidak perlu bangun server API,
  auth, dan deploy sendiri dari nol.
- Operasi kritis atomik (`checkoutTransaction`, `recordPayment`) menjadi
  **Postgres function (RPC)** — justru LEBIH baik dari Firestore karena
  transaksi DB native (tanpa batasan "semua read sebelum write").
- SQL asli → laporan/analitik (penjualan, stok, pembayaran) jauh lebih mudah,
  yang selama ini kelemahan Firestore.

## 2. Front-end: mobile Flutter + web Next.js

**Keputusan (2026-07-15): web pakai Next.js/React + `supabase-js`.** Mobile
tetap Flutter. Satu backend Supabase melayani **kedua** client (satu DB, satu
auth, satu RLS).

Konsekuensi penting dari dua front-end (Flutter + Next.js):

- **Logika bisnis WAJIB tinggal di server**, bukan diduplikasi di Dart *dan*
  TS. Kalau `computeTotals`/`checkout`/status invoice ditulis dua kali,
  gampang beda hasil. → Semua operasi & hitungan kritis dipusatkan di
  **Supabase (RPC / Edge Function)**; kedua client cuma memanggil.
- **Sinergi TypeScript**: Next.js = TS, dan Edge Function Supabase = Deno/TS.
  Util yang sudah ada di `functions/src/**` (`phone`, `totals`, `invoice`,
  `validation`) beserta test vitest-nya bisa **dipindah nyaris apa adanya**
  ke Edge Function → langsung dipakai bareng web. Ini menguatkan pilihan
  Decision #2 ke arah Edge Function (TS), bukan Postgres function murni.
- **Auth**: `supabase_flutter` (mobile) + `@supabase/ssr`/`@supabase/supabase-js`
  (Next.js) berbagi satu Supabase Auth & sesi.
- **Trade-off**: dua codebase front-end (effort lebih besar dari Flutter Web),
  tapi UX web untuk dashboard/laporan jauh lebih baik dan ringan di browser.

## 3. Arsitektur target

```
                    ┌───────────────────────────┐
   Flutter Mobile ──►                            │
   (Android/iOS)     │   Supabase                │
                     │   • PostgreSQL (data)     │
   Next.js Web    ──►│   • Auth (JWT + role)     │
   (panel admin,     │   • Realtime (WebSocket)  │
    supabase-js)     │   • Storage (foto job)    │
                     │   • RLS (izin per-role)   │
                     │   • Edge Function (TS):   │
                     │     checkout, recordPayment,│
                     │     dipakai mobile & web  │
                     └───────────────────────────┘
```

- **Data**: tabel PostgreSQL (§5), snake_case (sudah sesuai konvensi sekarang).
- **Auth**: Supabase Auth; role disimpan di custom claim JWT + kolom `role`
  pada tabel `users` (pola sama seperti sekarang). RLS baca role dari JWT.
- **Realtime**: Supabase Realtime menggantikan Firestore `snapshots()` —
  repository Dart tetap expose `Stream<...>`, cuma sumbernya diganti.
- **Operasi kritis**: Postgres function (`rpc`) dalam satu transaksi DB.

## 4. Pemetaan Firebase → Supabase

| Firebase sekarang | Supabase target |
|---|---|
| `firebase_auth` + custom claims | Supabase Auth + `role` di JWT/`users` |
| Firestore koleksi | Tabel PostgreSQL |
| Subcollection (`transactions/{id}/items`) | Tabel anak dgn FK (`transaction_items.transaction_id`) |
| Array dalam dokumen (`service_orders.units[]`) | Tabel anak `service_order_units` (relasional) atau kolom `jsonb` |
| Security Rules (`firestore.rules`) | Row Level Security (policy SQL per tabel) |
| Cloud Functions callable | Postgres function `rpc()` (atomik) atau Edge Function (Deno/TS) |
| `counters/invoice_YYYYMMDD` | `sequence` Postgres atau tabel `counters` + `SELECT ... FOR UPDATE` |
| Storage (foto job Fase 5) | Supabase Storage (API mirip) |
| FCM (Fase 7) | FCM tetap, dipicu dari Edge Function/webhook |
| Emulator Firebase | Supabase local (Docker) via `supabase start` |

## 5. Draft skema SQL (dari koleksi existing)

Tabel inti (mengikuti field yang sudah ada di model Dart & spec bab 4):

- `users` (id uuid PK = auth.uid, email, display_name, role, active)
- `products`, `spareparts`, `services`, `installation_packages`
- `members` (phone UNIQUE, customer_type, member_since, total_ac_units, active)
- `member_ac_units` (member_id FK, brand, model, pk, room_location,
  barcode_value UNIQUE, serial_number, status, tanggal2)
- `transactions` (member_id FK, subtotal, discount, tax_percent, tax_amount,
  transport_fee, grand_total, notes, created_by, created_at)
- `transaction_items` (transaction_id FK, kind, ref_id, name, unit, qty,
  unit_price, line_total) ← dulu subcollection
- `invoices` (number UNIQUE, transaction_id FK, member_id, customer_name/phone,
  subtotal…grand_total, total_paid, status, created_by, created_at)
- `invoice_items` (invoice_id FK, …) ← dulu array snapshot `items[]`
- `manual_payments` (invoice_id FK, method, amount, note, proof_url, created_by,
  created_at)
- `stock_movements` (item_kind, ref_id, name, qty_change, reason,
  transaction_id FK, created_by, created_at)
- `service_orders` (member_id, transaction_id, invoice_id, type, status,
  created_by, created_at)
- `service_order_units` (order_id FK, unit_id FK, status) ← dulu `units[]`
- `technician_jobs` (order_id FK, member_id, unit_id, technician_id,
  type, status, scheduled_date, created_by, created_at)

Peningkatan yang dimungkinkan Postgres: FK + index nyata, `UNIQUE` constraint
(phone, barcode, invoice number) dijamin DB, nomor invoice pakai `sequence`.

## 6. Business logic → Postgres RPC

`checkoutTransaction` & `recordPayment` (sudah ada di `functions/src/pos/`)
dipindah jadi **Postgres function** dalam `BEGIN…COMMIT`:

- Util MURNI (`computeTotals`, `computeInvoiceStatus`, `formatInvoiceNumber`,
  `normalizePhone`) → **portable**: bisa jadi SQL function kecil, atau tetap
  di TS bila pakai Edge Function. Test vitest yang ada jadi acuan paritas.
- Keunggulan: transaksi DB Postgres tidak punya batasan Firestore
  "semua read sebelum write" — kode jadi lebih lurus.
- Harga TETAP diambil server dari tabel master (client tak kirim harga) —
  prinsip keamanan ini dipertahankan.

## 7. Portable vs tulis ulang

**Portable (nyaris tanpa ubah):**
- Semua logika bisnis murni Dart di `cart_state.dart`, model (`Invoice`,
  `Member`, dst) — cuma sumber data & (de)serialisasi yang berubah.
- UI/screens Flutter (list, form, POS, checkout, detail) — tetap, hanya
  provider di belakangnya yang ganti sumber.
- Util TS di `functions/src/**` + test-nya → acuan logika RPC.

**Ditulis ulang:**
- Semua `*_repository.dart` (Firestore → Supabase query/realtime).
- Providers yang memanggil `FirebaseFunctions` → panggil `rpc()`.
- Auth (`auth_repository.dart`, `firebase_options.dart`, bootstrap).
- `firestore.rules` → policy RLS SQL.
- `checkoutTransaction`/`recordPayment` → Postgres function.

## 8. Urutan migrasi (bertahap, tetap bisa jalan)

1. **Setup Supabase** — project + `supabase` CLI local (Docker), skema SQL
   (§5) via migration file, seed admin.
2. **Auth** — ganti `firebase_auth` → `supabase_flutter`; login/guard/role
   jalan; update test auth.
3. **Master data (Fase 2)** — repository products/spareparts/services/packages
   → Supabase; RLS admin-only; verifikasi CRUD.
4. **Member & unit (Fase 3)** — repository + RLS + generate barcode (RPC).
5. **POS & pembayaran (Fase 4)** — `checkoutTransaction`/`recordPayment` →
   Postgres RPC; repository invoice/payment → Supabase Realtime; struk PDF
   tetap. Ini bagian terbesar.
6. **RLS finansial** — port aturan `firestore.rules` finansial ke policy RLS
   + test.
7. **Web (Flutter Web)** — aktifkan target web, sesuaikan yang perlu, deploy
   (Supabase/Vercel/Netlify hosting).
8. **Lanjut Fase 5–8** langsung di atas stack baru.

Tiap langkah diakhiri verifikasi (Supabase local) sebelum lanjut — pola sama
seperti fase Firebase.

## 9. Risiko & catatan

- **Effort besar**: membongkar data-layer Fase 1–4. Realistis, bukan
  "ganti config".
- **Offline sync**: Firestore offline otomatis; Supabase belum sekuat itu.
  Bila teknisi lapangan butuh offline penuh, perlu strategi caching manual
  (mis. `drift`/local DB + sync) — perlu dievaluasi di Fase 5.
- **Realtime**: Supabase Realtime perlu tabel di-`enable`; sedikit setup
  ekstra vs Firestore.
- **Verifikasi**: butuh Docker (Supabase local) di mesin dev; Flutter SDK
  juga (belum tersedia di lingkungan pembuatan saat ini).

## 10. Keputusan

1. ~~Front-end web~~ → **DIPUTUSKAN: Next.js/React + supabase-js** (§2).
2. ~~Logika kritis~~ → **DIPUTUSKAN (2026-07-15): Postgres RPC (PL/pgSQL)**,
   sesuai §6/§8. Alasan vs Edge Function: atomik native dalam satu transaksi
   DB, tanpa deploy/service-role tambahan, dipanggil identik dari Flutter dan
   Next.js (`.rpc()`). Util TS yang di-reuse hanya ~60 baris — biaya port
   kecil; test vitest di `functions/src/**` tetap dipertahankan sebagai acuan
   paritas logika & pesan error.

3. ~~Migrasi data lama~~ → **DIPUTUSKAN: mulai DB bersih.** Data Firestore
   lama (data dev) TIDAK dimigrasikan — dibuang. Konsekuensi: tidak ada
   langkah migrasi data; skema SQL langsung diisi lewat seed baru. Catatan:
   penghapusan data Firebase asli dilakukan user di Console (data emulator
   ephemeral). **Kode Flutter Fase 1–4 tetap dipakai & dimigrasikan — bukan
   dihapus.**

Masih terbuka:

4. **Offline lapangan**: seberapa wajib fitur offline untuk teknisi Fase 5?
   *Tidak memblokir mulai migrasi (Fase 1–4 tak butuh offline); bisa
   diputuskan saat masuk Fase 5.*

## 11. Log progres

**2026-07-15 — langkah §8.1–8.6 ditulis (satu sesi):**

- `supabase/config.toml` (init CLI): signup dimatikan, custom access token
  hook aktif (`user_role` masuk klaim JWT dari `public.users`, hanya bila
  user aktif).
- Migrasi SQL (`supabase/migrations/`):
  - `...0001_init_schema.sql` — skema inti + trigger profil user + counter.
  - `...0002_auth_role_hook.sql` — hook klaim `user_role` + helper `jwt_role()`.
  - `...0003_rls_policies.sql` — port `firestore.rules` ke RLS.
  - `...0004_realtime.sql` — publication untuk tabel yang di-stream client.
  - `...0005_pos_functions.sql` — RPC `checkout_transaction`,
    `record_payment`, `generate_ac_unit_barcode`, `save_installation_package`
    + util (`normalize_phone`, `compute_invoice_status`). Pesan error identik
    dengan Cloud Functions. Deviasi sengaja: kunci tanggal pakai
    Asia/Jakarta; guard role RPC baca tabel `users` (bukan klaim); qty product
    wajib bulat.
- Flutter: `firebase_*`/`cloud_*` dicabut dari pubspec → `supabase_flutter`.
  Auth, CRUD generik, unit AC, invoice → repositori Supabase; paket instalasi
  pakai repositori khusus (`SupabasePackageRepository`, item di tabel anak via
  RPC atomik). Model master dinormalkan ke kunci snake_case; tanggal ISO-8601.
  Providers memanggil `.rpc()`; `firebase_options.dart` & bootstrap Firebase
  dihapus. UI/screens & test fake TIDAK berubah (kontrak repo dipertahankan).
- `functions/` TIDAK dihapus: vitest-nya adalah acuan paritas RPC. File
  konfigurasi Firebase root (firebase.json, firestore.rules) dibiarkan sampai
  verifikasi selesai (langkah §8.7+), lalu dibersihkan.
- **Belum diverifikasi**: `supabase start` butuh Docker (aktifkan integrasi
  WSL di Docker Desktop), `flutter test` butuh Flutter SDK di mesin dev.
  Langkah verifikasi: lihat SETUP.md bagian Supabase.

**2026-07-16 — verifikasi backend di Supabase lokal (Docker + CLI 2.109.1):**

- `supabase start`/`db reset`: **6 migrasi apply bersih** (0001–0006), seed
  jalan tanpa error. Skema (19 tabel), fungsi (12), dan 3 user seed cocok.
- **RPC paritas OK** (uji end-to-end via psql, simulasi klaim JWT):
  - `checkout_transaction`: total persis (subtotal 8.255.000, pajak 11%
    = 902.550, transport tak kena pajak, grand 9.182.550), stok berkurang,
    member auto-dibuat, unit AC + job teknisi `assigned`, nomor invoice
    memakai date-key WIB baru (`INV-20260716-0001`).
  - `record_payment`: transisi `belum_dibayar→lunas` dan `dp` benar.
  - 7 kasus error raise pesan **identik** dgn Cloud Functions (Hanya
    Admin/Kasir, Qty produk harus bilangan bulat, Stok … tidak cukup, Item
    duplikat, Melebihi sisa tagihan, jumlah bilangan bulat, Diskon melebihi
    subtotal). `normalize_phone`/`compute_invoice_status` sesuai.
- **RLS OK**: kasir baca invoices (3), teknisi 0 baris (difilter, bukan
  error); kasir insert product ditolak policy, admin sukses; tulis langsung
  ke invoices oleh client tetap tertutup (hanya via RPC definer);
  counters/audit_logs tertutup. Hook `custom_access_token_hook` mengisi
  klaim `user_role`.
- **Referensi TS**: `vitest run` di `functions/` → **27/27 lulus** (acuan
  paritas utuh).

- **BUG DITEMUKAN & DIPERBAIKI — migrasi 0006 (`..._grants.sql`)**: migrasi
  0001–0005 hanya mengaktifkan RLS + policy tapi **tak pernah `GRANT` privilege
  tabel** ke role `authenticated`. RLS hanya membatasi baris, bukan memberi
  hak akses tabel; tabel milik `postgres` (yang menjalankan migrasi) di
  `pg_default_acl` hanya dapat `Dxtm` (tanpa select/insert/update/delete).
  Akibatnya **setiap** query client via PostgREST akan gagal
  `permission denied for table` sebelum RLS dievaluasi — seluruh app tak jalan.
  Perbaikan: grant presisi sesuai desain RLS (SELECT semua tabel baca kecuali
  counters/audit; INSERT/UPDATE master+member+unit; INSERT/DELETE item paket
  untuk RPC SECURITY INVOKER; finansial tetap read-only + tulis via RPC).
  Diverifikasi ulang setelah `db reset`: semua skenario RLS lulus.

- **Flutter (mesin dev Windows, 2026-07-16)**: `flutter test` → **86/86 lulus**.
  Sisi Dart (model snake_case, repo Supabase, providers `.rpc()`, guard) hijau.

- **Status verifikasi §8.1–8.6: SELESAI** (backend Supabase lokal + Flutter test).
  Berikutnya: §8.7 (web Next.js) & Fase 5, atau jalankan app end-to-end terhadap
  Supabase lokal untuk uji manual sebelum lanjut.
