# E-POS AC — Rencana Struktur Frontend Next.js

**Konteks:** `frontend/` yang ada sekarang (`index.html` + `app.js`, vanilla JS) itu **alat uji siklus**, bukan produk final — dipakai buat verifikasi tiap endpoint NestJS jalan end-to-end selama development (Siklus 1-9). Dokumen ini rencana buat frontend **beneran** pakai Next.js yang bakal dipakai Admin/Kasir/Teknisi sehari-hari.

Backend sudah nge-cover 9 dari 10 siklus (lihat `2026-08-20-roadmap-siklus-epos_1.md`), jadi kontrak API-nya sudah cukup stabil buat mulai desain frontend di atasnya. Siklus 5/6/8/9 masih belum divalidasi end-to-end di project asli — kalau ada perubahan kontrak API pas testing nanti, sesuaikan dokumen ini juga.

---

## 1. Tech stack yang direkomendasikan

| Kebutuhan | Rekomendasi | Alasan |
|---|---|---|
| Framework | **Next.js 15, App Router, TypeScript** | Standar industri sekarang, route groups App Router pas banget buat pisah shell per role (lihat §3). |
| Styling & komponen | **Tailwind CSS + shadcn/ui** | Komponen di-copy ke repo sendiri (bukan npm dependency tertutup), gampang di-custom, gratis. Alternatif: **Ant Design** — lebih cepat buat bikin CRUD/tabel banyak (Table, Form, DatePicker udah jadi), tapi lebih susah di-custom & lebih berat bundle-nya. EPOS ini BANYAK tabel (produk, invoice, stock movements, dll) jadi Ant Design layak dipertimbangkan kalau kecepatan build lebih penting dari kebebasan desain. **Ini keputusan yang perlu dikonfirmasi user** (lihat §6).
| Server state (data dari API) | **TanStack Query (React Query)** | Auto cache, refetch, loading/error state — cocok banget buat REST backend yang udah ada. Query key per endpoint (mis. `['products']`, `['technician-jobs', jobId]`), invalidate abis mutation (create/update).
| Client state (UI-only) | **Zustand** | Ringan, gak perlu boilerplate Redux. Dipakai buat: cart POS sebelum checkout, filter state, dll. **Auth session** sengaja BUKAN di Zustand kalau pakai httpOnly cookie (lihat §4) — biar gak nyimpen token di JS yang bisa dibaca script lain.
| Realtime | **socket.io-client** | Backend udah pakai Socket.IO (`RealtimeGateway`, room `admin-dashboard`), tinggal port `frontend/app.js`-nya yang connect-listen `transaction.created`/`job.status_changed`/`invoice.updated`/`material_request.created`/`material_request.decided`.
| Form & validasi | **react-hook-form + zod** | Validasi di frontend bisa MIRROR aturan `class-validator` DTO backend (mis. `discount > 0` wajib `discountReason`, `qty` produk harus bilangan bulat) — bukan duplikat logic, tapi first-line-of-defense biar error 400 gak sering muncul ke user.
| HTTP client | **fetch bawaan + wrapper tipis** (`lib/api-client.ts`) | Gak perlu axios — backend udah konsisten `{message}` buat error (lihat `HttpExceptionFilter`), tinggal 1 wrapper yang unwrap itu + inject `Authorization` header (kalau JWT-di-header) atau `credentials: 'include'` (kalau cookie).
| QR/barcode | **html5-qrcode** atau **@zxing/browser** buat SCAN pakai kamera HP kasir/teknisi | `frontend/app.js` versi lama cuma generate QR (`qrcodejs`) + input manual barcode, belum pernah scan pakai kamera — ini upgrade nyata buat versi Next.js, sesuai requirement asli ("scan QR" bukan "ketik manual").

---

## 2. Auth & role-based access

Backend: `POST /auth/login` balikin `{ accessToken, user: {id, email, displayName, role} }`, JWT payload `{sub, role}`. Role: `admin` | `kasir` | `teknisi`.

**Dua opsi penyimpanan token — perlu diputuskan (§6):**

- **Opsi A — httpOnly cookie (direkomendasikan buat produksi).** Next.js Route Handler (`app/api/auth/login/route.ts`) jadi proxy: terima email/password dari form, panggil `POST {API_BASE}/auth/login` ke backend NestJS, lalu `Set-Cookie` httpOnly (gak bisa dibaca `document.cookie`/script). `middleware.ts` baca cookie itu buat guard route (redirect ke `/login` kalau gak ada, redirect ke halaman "gak boleh akses" kalau role gak cocok sama route group). Lebih aman dari XSS (token gak pernah nyentuh `localStorage`/state JS), tapi butuh sedikit lapisan proxy tambahan.
- **Opsi B — localStorage (lebih simpel, sama kayak `frontend/app.js` lama).** Token disimpan di client, dikirim manual di header `Authorization: Bearer` tiap request lewat `api-client.ts`. Lebih gampang di-setup, tapi rawan kebaca script pihak ketiga kalau ada XSS (untuk sistem internal toko yang cuma dipakai 2-3 orang, risiko ini kecil — bukan berarti nol).

Rekomendasi: **Opsi A** kalau nanti bakal diakses dari jaringan luar toko (bukan cuma LAN lokal); **Opsi B** cukup kalau EPOS ini cuma dipakai di 1-2 komputer kasir dalam toko yang gak pernah expose ke internet luas.

---

## 3. Struktur folder (App Router)

```
epos-frontend/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── login/page.tsx
│   │   ├── (dashboard)/                     # shell terauth, guard lewat middleware.ts
│   │   │   ├── layout.tsx                   # topbar + sidebar nav (item nav beda per role)
│   │   │   ├── dashboard/page.tsx           # GET /dashboard/summary (admin)
│   │   │   ├── master-data/
│   │   │   │   ├── products/page.tsx        # GET/POST /products
│   │   │   │   ├── spareparts/page.tsx      # GET/POST /spareparts
│   │   │   │   ├── services/page.tsx        # GET/POST /services
│   │   │   │   ├── users/page.tsx           # GET/POST /users (admin)
│   │   │   │   └── vouchers/
│   │   │   │       ├── page.tsx             # GET/POST /vouchers/campaigns
│   │   │   │       └── [campaignId]/offer/page.tsx  # cari member + POST .../offer
│   │   │   ├── pos/
│   │   │   │   └── page.tsx                 # cart + POST /pos/checkout, GET /vouchers/my-claims
│   │   │   ├── service-intake/page.tsx      # POST /service-orders/intake
│   │   │   ├── jobs/
│   │   │   │   ├── page.tsx                 # GET /technician-jobs (admin/kasir), /queue (teknisi)
│   │   │   │   ├── scan/page.tsx            # scan QR unit → GET /ac-units/lookup/:barcode
│   │   │   │   └── [jobId]/page.tsx         # detail: findings, foto, material request, review
│   │   │   ├── invoices/
│   │   │   │   ├── page.tsx                 # GET /invoices
│   │   │   │   └── [invoiceId]/page.tsx     # detail + POST payments
│   │   │   ├── stock/page.tsx               # POST /stock/in, /stock/opname, GET /stock/movements
│   │   │   ├── shifts/page.tsx              # GET/POST /shifts/*
│   │   │   ├── reports/
│   │   │   │   ├── sales/page.tsx           # GET /reports/sales
│   │   │   │   ├── service/page.tsx         # GET /reports/service
│   │   │   │   └── profit-loss/page.tsx     # GET /reports/profit-loss
│   │   │   └── settings/page.tsx            # GET/PUT /app-config
│   │   ├── api/
│   │   │   └── auth/
│   │   │       ├── login/route.ts           # proxy login (Opsi A cookie)
│   │   │       └── logout/route.ts
│   │   ├── layout.tsx                        # root layout, font, providers
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                               # primitives shadcn/ui (button, table, dialog, badge, ...)
│   │   ├── layout/                           # Topbar, Sidebar, RoleNav
│   │   └── domain/
│   │       ├── pos/CartTable.tsx, VoucherPicker.tsx, InstallationForm.tsx
│   │       ├── jobs/FindingList.tsx, PhotoUploader.tsx, QrScanner.tsx, MaterialRequestForm.tsx
│   │       ├── invoices/PaymentForm.tsx
│   │       └── reports/DateRangePicker.tsx, SalesChart.tsx
│   ├── lib/
│   │   ├── api-client.ts                     # fetch wrapper, unwrap {message}, base URL dari env
│   │   ├── auth.ts                           # getSession()/requireRole() helpers (server-side)
│   │   ├── socket.ts                         # singleton socket.io-client, connect sekali di layout
│   │   └── format.ts                         # formatRupiah, formatDate — port dari app.js lama
│   ├── hooks/
│   │   └── queries/                          # 1 file per resource, isinya useQuery/useMutation TanStack
│   │       ├── use-products.ts
│   │       ├── use-technician-jobs.ts
│   │       ├── use-vouchers.ts
│   │       ├── use-invoices.ts
│   │       └── ...
│   ├── stores/
│   │   ├── cart-store.ts                     # zustand — keranjang POS sebelum checkout
│   │   └── ui-store.ts                       # zustand — sidebar collapsed, dll (opsional)
│   ├── types/
│   │   └── api.ts                            # interface TS MIRROR entity Prisma (Product, Invoice, TechnicianJob, dst)
│   └── middleware.ts                         # guard: cek cookie/token + role vs route group
├── public/
├── .env.local                                 # NEXT_PUBLIC_API_BASE / API_BASE (server-only kalau proxy)
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

---

## 4. Mapping halaman → role (siapa boleh lihat apa)

| Halaman | admin | kasir | teknisi | Catatan |
|---|:-:|:-:|:-:|---|
| `dashboard` | ✅ | – | – | `Roles('admin')` di backend |
| `master-data/*` | ✅ | sebagian (lihat produk/sparepart/jasa buat cari item, gak bisa tambah user) | – | |
| `pos` (checkout) | ✅ | ✅ | – | |
| `service-intake` | ✅ | ✅ | – | |
| `jobs` (list + scan) | ✅ | ✅ (lihat) | ✅ (queue miliknya) | teknisi cuma liat job dia sendiri (`GET /technician-jobs/queue`) |
| `jobs/[jobId]` (detail, review) | ✅ (approve/send-back) | – | ✅ (kerjain job miliknya) | |
| `invoices/*` | ✅ | ✅ | – | |
| `stock` | ✅ | – | – | admin-only di backend |
| `shifts` | ✅ (semua shift) | ✅ (shift sendiri) | – | |
| `reports/*` | ✅ | – | – | admin-only |
| `settings` (app-config) | ✅ (ubah) | ✅ (baca doang, mis. tax %) | ✅ (baca doang) | `GET /app-config` semua role, `PUT` admin-only |

Route group `(dashboard)/layout.tsx` cukup 1 layout buat semua role (nav item-nya di-filter dinamis dari `user.role`), BUKAN 3 folder terpisah per role — lebih gampang maintain daripada duplikat struktur folder 3x. `middleware.ts` yang jaga: kalau kasir coba akses `/stock` langsung, redirect balik / tampilkan 403.

---

## 5. Hal-hal spesifik yang WAJIB diperhatikan pas porting dari `frontend/app.js` lama

Beberapa detail perilaku yang gampang kelewat kalau nulis ulang dari nol (udah ketemu & di-fix selama sesi-sesi sebelumnya):

1. **Diskon ad-hoc + voucher DIJUMLAH**, bukan pilih salah satu (Siklus 6) — UI checkout harus nampilin dua-duanya sebagai baris terpisah di ringkasan total.
2. **`kurang_bayar` itu status invoice yang STICKY** — begitu invoice `lunas` lalu ada tagihan tambahan (approve pengajuan sparepart teknisi), status jadi `kurang_bayar` dan BUKAN balik ke `dp`. UI status badge invoice harus nge-handle 6 status: `belum_dibayar`/`dp`/`kurang_bayar`/`lunas`/`refund`/`batal`.
3. **Vokabuler status job**: `menunggu_penugasan` → `assigned` → `sedang_dikerjakan` → `menunggu_review` → `selesai`/`dibatalkan` (+ jalur balik `menunggu_review` → `sedang_dikerjakan` lewat `sendBack`). JANGAN pakai `in_progress` (itu nama lama yang gak pernah valid).
4. **Checklist itu dinamis (`JobFinding`), bukan template tetap** — tiap job punya daftar temuan sendiri, tiap temuan butuh foto `sebelum` DAN `sesudah` sebelum job bisa `submitForReview`. UI harus jelas nunjukin temuan mana yang masih kurang foto.
5. **Pengajuan material 2 tahap**: `create` (status `pending`, BELUM potong stok) → admin `decide` (approve nambah tagihan invoice) → `markUsed` (BARU stok kepotong). Jangan asumsi stok langsung kepotong pas teknisi ajukan.
6. **Material request approval nambah tagihan invoice** — kalau invoice td-nya udah `lunas`, statusnya jadi `kurang_bayar` (bukan tetap `lunas`). Halaman invoice harus auto-refresh/re-fetch abis approve material request biar total & status ke-update.

---

## 6. Keputusan yang perlu dikonfirmasi sebelum mulai scaffold

Biar gak bolak-balik ubah struktur setelah mulai coding, 3 hal ini sebaiknya diputuskan duluan:

1. **Auth: httpOnly cookie (lebih aman, sedikit lebih ribet) vs localStorage (lebih simpel, sama kayak versi lama)?**
2. **Component library: shadcn/ui+Tailwind (fleksibel, custom look) vs Ant Design (lebih cepat buat CRUD/tabel banyak)?**
3. **Lokasi repo: folder terpisah `epos-frontend/` sejajar sama `epos-backend/` (2 repo/folder independen) vs jadi 1 monorepo?**

---

## 7. Urutan pengerjaan yang disarankan (kalau lanjut scaffold beneran)

1. Setup project (`create-next-app`, Tailwind, shadcn/ui atau Ant Design sesuai keputusan §6), `api-client.ts`, auth flow (login page + middleware guard) — validasi bisa login sebagai admin/kasir/teknisi dan ke-redirect sesuai role.
2. Master Data (CRUD paling sederhana, bagus buat validasi pola `useQuery`/`useMutation` + form + tabel dulu sebelum ke halaman yang lebih kompleks).
3. POS/Checkout (paling kompleks — cart, instalasi, voucher, submit).
4. Job Board + detail job (scan QR pakai kamera, findings, foto, material request, review admin).
5. Invoice & Pembayaran, Stock, Shift.
6. Reports & Dashboard + realtime socket (paling akhir, gak ada dependency ke apapun sebelumnya selain data yang udah ada).

---

## Dependency

Seluruh dokumen ini bergantung ke kontrak API yang sudah dibangun di Siklus 1-9 (lihat `2026-08-20-roadmap-siklus-epos_1.md`). Siklus 5/6/8/9 belum divalidasi end-to-end — kalau ternyata ada penyesuaian kontrak API pas testing, update bagian §4 (mapping endpoint) di dokumen ini juga.
