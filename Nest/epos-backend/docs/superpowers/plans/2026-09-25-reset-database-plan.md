# Reset Database (Pengaturan) — Implementation Plan

**Goal:** Fitur "Reset Database" di halaman Pengaturan (admin-only), 3 tingkat cakupan (Reset Transaksi / +Pelanggan / Total), dengan konfirmasi ketik-ulang teks per scope, tanpa fitur backup wajib (cuma peringatan teks).

**Keputusan yang sudah disetujui user (AskUserQuestion):**
1. Mekanisme konfirmasi: **ketik ulang teks konfirmasi** (bukan password, bukan Ya/Batal biasa).
2. Akses: **admin doang**.
3. Backup: **cuma peringatan teks**, tidak ada fitur export wajib/ditawarin.

**Temuan riset penting:**
- `/pengaturan` **sudah** di-gate admin-only di `proxy.ts` (`ROLE_PREFIXES`) — non-admin dilempar balik ke `ROLE_HOME`-nya sebelum Server/Client Component manapun render. Jadi **tidak perlu** tambahan role-check di level halaman/komponen — cukup pasang guard admin-only yang sama seperti endpoint lain di backend (`@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin')`).
- `Counter` (nomor urut) HARUS direset **granular per key**, bukan diborong `deleteMany()` semua — kalau scope tidak menghapus data yang dinomori itu, reset counter-nya bisa bikin nomor baru TABRAKAN dengan yang lama:
  - `invoice_<dateKey>` — aman direset di **semua scope** (Invoice selalu ikut kehapus di scope manapun).
  - `acunit_<dateKey>` — cuma direset kalau `MemberAcUnit` ikut kehapus (scope `transaksi_pelanggan`, `total`).
  - `product_sku` — cuma direset kalau `Product` ikut kehapus (scope `total` doang).
- Urutan hapus per-scope (child sebelum parent, ditelusuri manual dari `prisma/schema.prisma`, dikonfirmasi tidak ada `onDelete: Cascade` di skema ini kecuali 1 `SetNull` di `ManualPayment.shift`):

  **Tier 1 — Transaksi & histori (SEMUA scope):**
  `JobFindingPhoto → JobFinding → JobPhoto → MaterialRequestItem → InvoiceAdjustment → ManualPayment → MaterialRequest → TechnicianJob → ServiceOrderUnit → ServiceOrder → InvoiceItem → WhatsappLog → Voucher → Invoice → TransactionItem → Transaction → StockMovement → CashierShift → Notification → AuditLog(lama) → SyncActionLog → Counter(prefix `invoice_`)`

  **Tier 2 — Pelanggan & unit AC (scope `transaksi_pelanggan`, `total`):**
  `MemberAcUnit → Member → Counter(prefix acunit_)`

  **Tier 3 — Master data katalog (scope `total` doang):**
  `Product.pairedProductId → null (updateMany dulu, self-FK) → InstallationPackageItem → InstallationPackage → ItemCost → Product → Sparepart → Service → ProblemCategory → Counter(key product_sku)`

  Ditutup dengan **1 baris `AuditLog` baru** (`action: 'system.reset'`, `detail: <hasil hitung per tabel>`) ditulis PALING TERAKHIR di transaksi yang sama, jadi selalu jadi satu-satunya sisa audit trail setelah reset.
- `DeviceToken`, `User`, `AppConfig`, `ReminderSetting`, `WaReminderTemplate` **tidak pernah** ikut ke-reset di scope manapun.

**Architecture:**
- Backend: module baru `src/system-reset/` (controller+service+dto, pola sama seperti `services-catalog/`), guard `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin')` di level controller, satu endpoint `POST /system-reset`. Validasi `confirmText` di service (bukan cuma DTO) — literal per-scope, salah ketik → `BadRequestException`. Seluruh delete di 1 `prisma.$transaction(async (tx) => {...}, { timeout: 30000 })`.
- Frontend: section baru "Zona Bahaya" di `pengaturan/page.tsx`, 3 card (satu per scope) dengan tombol destructive, masing-masing buka `ResetScopeDialog` (komponen baru) yang minta ketik-ulang teks sebelum tombol konfirmasi aktif. Sukses → toast + ringkasan jumlah baris terhapus per scope.

**Tech Stack:** NestJS + Prisma + class-validator (backend, existing pattern). Next.js + TanStack Query + shadcn Dialog/Input (frontend, existing pattern). Tidak ada dependency baru.

---

## Task 1: Backend — module `system-reset`

**Files:**
- Create: `src/system-reset/dto/reset-database.dto.ts`
- Create: `src/system-reset/system-reset.service.ts`
- Create: `src/system-reset/system-reset.controller.ts`
- Create: `src/system-reset/system-reset.module.ts`
- Modify: `src/app.module.ts` (daftarin `SystemResetModule`)

DTO nyimpen `RESET_SCOPES`, `ResetScope`, dan `RESET_CONFIRM_TEXT` (frasa literal per scope: `HAPUS TRANSAKSI` / `HAPUS TRANSAKSI PELANGGAN` / `HAPUS TOTAL`) — dipakai service buat validasi & dicontek frontend (hardcode manual, gak ada shared package).

Service: 1 method `reset(scope, confirmText, actorId)` — validasi teks dulu (lempar `BadRequestException` kalau gak cocok persis), baru jalanin transaksi delete sesuai tier di atas, balikin `{ scope, deletedCounts, resetAt }`.

Controller: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin')` di class level, `POST /system-reset` nerima `ResetDatabaseDto`, teruskan ke service dengan `@CurrentUser() user` buat `actorId`.

## Task 2: Frontend — UI Zona Bahaya di Pengaturan

**Files:**
- Create: `src/components/pengaturan/reset-scope-dialog.tsx`
- Modify: `src/app/(dashboard)/pengaturan/page.tsx`

Card baru di bawah Card "Umum" existing, border merah/destructive, judul "Zona Bahaya — Reset Database". 3 baris (Reset Transaksi / +Pelanggan / Total), masing-masing deskripsi singkat + tombol `variant="destructive"` yang buka `ResetScopeDialog` dengan props scope-spesifik (judul, daftar data yang kehapus, `confirmPhrase`). Dialog: `Input` buat ketik ulang, tombol konfirmasi `disabled` sampai teksnya persis sama, mutation `apiClient.post('/system-reset', { scope, confirmText })`, sukses → toast ringkasan total baris terhapus + tutup dialog.

---

## Self-review checklist (sebelum eksekusi)
- [x] Semua 4 kategori data dari riset awal (transaksi, pelanggan, master data, akun/settings) sudah kepetakan ke scope yang benar.
- [x] Urutan delete FK-safe — ditelusuri manual dari schema penuh (989 baris), tidak ada tabel yang dihapus sebelum semua anaknya.
- [x] Counter direset granular per prefix, bukan diborong, biar gak collision sama data yang gak ikut kehapus.
- [x] AuditLog lama ikut wipe (scope manapun) tapi 1 baris baru ditulis di akhir transaksi yang sama — riwayat reset itu sendiri selalu tersisa.
- [x] Role-gating sudah ada di `proxy.ts` (route-level) — endpoint backend tetap dipasangi guard sendiri (defense in depth, gak boleh cuma andelin frontend).
