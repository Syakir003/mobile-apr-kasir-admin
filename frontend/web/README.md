# E-POS AC — Web (Next.js)

Pondasi frontend web di atas **backend Supabase yang sama** dengan app Flutter.
App Router + TypeScript + Tailwind v4 + `@supabase/ssr`.

## Yang sudah ada

- **Auth** end-to-end: login (`/login`), refresh sesi via `middleware.ts`, logout.
- **Proteksi rute**: semua di grup `(app)` butuh login (middleware + guard layout).
- **Role dari JWT** (`user_role`) → menu sidebar per peran (`lib/roles.ts`).
- **Typed RPC** semua penulisan (`lib/rpc.ts`): `checkout_transaction`,
  `record_payment`, `assign_technician_job`, `update_technician_job_status`.
- **Contoh baca data**: `/transaksi` (invoices) & `/jobs` (technician_jobs).
- Tema teal + slate (mengikuti app).

## Menjalankan

```bash
cd web
cp .env.local.example .env.local     # isi URL + anon key Supabase
npm install
npm run dev                          # http://localhost:3000
```

Pastikan backend Supabase jalan (lokal: `supabase start`, atau isi kredensial
cloud di `.env.local`). Buat/atur user + role di tabel `public.users`.

## Struktur

```
app/
  layout.tsx            Root
  login/                Halaman login + server action
  auth/signout/         Route handler logout
  (app)/                Grup terproteksi (butuh login)
    layout.tsx          Guard + sidebar per peran
    page.tsx            Dashboard
    transaksi/          Contoh baca invoices
    jobs/               Contoh baca job (teknisi = miliknya)
    [...slug]/          Placeholder rute yang belum dibuat
lib/
  supabase/             client (browser) · server · middleware
  roles.ts              role dari JWT + menu per peran
  rpc.ts                wrapper RPC (semua tulis lewat sini)
  types.ts              tipe & label status (mirror backend)
  format.ts             rupiah & tanggal
middleware.ts           refresh sesi + redirect belum-login
```

## Aturan (sama seperti mobile)

1. **Tulis data hanya lewat RPC** (`lib/rpc.ts`) — jangan `insert/update` tabel
   finansial/operasional langsung.
2. **Role dari klaim JWT**, bukan query tabel — untuk gate menu. RLS menjaga data.
3. **Realtime** hanya tabel terdaftar; `service_orders`/`technician_jobs` pakai
   `select` biasa + refresh.
4. Operasi admin sensitif di server boleh pakai `SERVICE_ROLE_KEY` **khusus
   server** — jangan pernah expose ke client.

Referensi lengkap: `README.md` (root) & `docs/Flow-Sistem-EPOS-AC.md`.
