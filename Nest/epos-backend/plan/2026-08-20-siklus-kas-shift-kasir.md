# E-POS AC — Siklus 4: Kas & Shift Kasir (Backend NestJS)

> **Status: SUDAH DIIMPLEMENTASI.** Dokumen ini awalnya plan sebelum coding, dan mengasumsikan sistem ini punya status verifikasi pembayaran (`menunggu_verifikasi`/`terverifikasi`) di `manual_payments` — itu SALAH, sistem ini gak punya konsep verifikasi terpisah sama sekali (lihat koreksi di `PaymentsService`, sudah dijelaskan di dokumen Siklus 1 juga). Dokumen ini sudah di-rewrite jadi catatan "as-built", sama persis dengan kode yang jalan di `epos-backend/src/shifts/` sekarang.

**Goal:** Kasir bisa buka kasir (input modal awal) sebelum mulai layani transaksi, tutup kasir di akhir shift (input hasil hitung uang fisik), sistem otomatis hitung selisih vs uang tunai yang seharusnya masuk, dan admin/kasir bisa lihat laporan ringkas per shift (breakdown per metode pembayaran).

**Architecture:** Modul baru `shifts/` di monolith NestJS yang sama, plus modifikasi kecil ke `PaymentsService.record()` (Siklus 1) supaya tiap pembayaran otomatis diatribusikan ke shift kasir yang lagi buka. Row locking (`SELECT ... FOR UPDATE`) dipakai lagi buat cegah race condition "buka 2 shift sekaligus".

---

## Koreksi dari draft awal

1. **Gak ada `PaymentStatus` (`menunggu_verifikasi`/`terverifikasi`/`ditolak`) di `ManualPayment`.** Draft awal minta `expectedCash` cuma dihitung dari payment `status='terverifikasi'`, dan `record()` di-diff seolah ada langkah cari-shift-lalu-set-status. Yang beneran: `ManualPayment` gak punya kolom `status` sama sekali — begitu dicatat, pembayaran langsung final dan langsung di-apply ke invoice (kasir dipercaya karena pegang uang/bukti langsung). Jadi `expectedCash` (di `close()`) dan laporan (di `report()`) menghitung **semua** `manual_payments` yang nyambung ke shift, method `tunai` untuk kas fisik, tanpa filter status tambahan.
2. **Signature `PaymentsService.record()` beda.** Bukan `record(invoiceId, method, amount, proofUrl, actorId)` — yang asli `record(invoiceId: string, dto: RecordPaymentDto, actorId: string)`. Perubahan siklus ini cuma nambah 1 baris cari shift aktif + isi field `shiftId` di `tx.manualPayment.create()`, gak ubah signature atau logic lain method ini sama sekali.
3. **`id` semua model pakai `@default(uuid())`, bukan `cuid()`** — konsisten sama seluruh `schema.prisma` project ini (`User`, `AuditLog`, dst.), draft awal salah asumsi konvensi id.
4. **`computeInvoiceStatus` di `src/common/invoice-status.util.ts`**, bukan `pos/pos-calc.util.ts` seperti draft awal.
5. **Field FK createdBy pakai nama `createdById`** (bukan `createdBy`) — pola field-scalar-plus-relasi yang sama dipakai di semua model lain di project ini.

## Keputusan desain (sudah jalan)

1. **Shift itu atribusi opsional, bukan hard requirement transaksi.** `PaymentsService.record()` tetap jalan meskipun kasir yang login gak punya shift terbuka (admin input pembayaran, atau kasir lupa buka shift). `shiftId` di `manual_payments` di-set `null` kalau gak ketemu shift aktif — transaksi **tidak diblokir**.
2. **`shift_id` FK eksplisit di `manual_payments`, diisi PAS payment dibuat** — bukan dihitung ulang belakangan dari rentang tanggal `openedAt`/`closedAt` (rawan salah tarik kalau kasir buka-tutup berkali-kali sehari atau ada 2 kasir aktif barengan).
3. **`ON DELETE SET NULL` buat `shift_id`** — riwayat pembayaran/invoice gak boleh ikut hilang kalau data shift lama dihapus/diarsip.
4. **Satu kasir cuma boleh punya 1 shift terbuka.** Divalidasi cek `closedAt IS NULL` (row-locked) sebelum `POST /shifts/open` diizinkan — kasir yang lupa tutup shift kemarin harus tutup dulu, gak ada auto-close diam-diam.
5. **`expectedCash` cuma dari `method='tunai'`** — transfer/qris/ewallet gak masuk hitungan kas fisik karena uangnya gak pernah beneran ada di laci kasir.
6. **Row locking saat buka shift** — pola `FOR UPDATE` yang sama dengan `StockLockingService`, cegah dobel-klik/dobel-tab bikin 2 shift terbuka sekaligus.

## Struktur file (`src/shifts/` + modifikasi kecil ke `payments/`)

```
src/
  shifts/
    shifts.module.ts        → exports ShiftsService (dipakai PaymentsService)
    shifts.controller.ts
    shifts.service.ts
    dto/open-shift.dto.ts
    dto/close-shift.dto.ts
  payments/
    payments.service.ts     → tambah inject ShiftsService, isi shiftId di record()
    payments.module.ts      → tambah import ShiftsModule
  app.module.ts              → daftarin ShiftsModule
```

## Migration

Model baru `CashierShift` (`cashier_shifts`) + kolom `shift_id` nullable (FK `ON DELETE SET NULL`) di `manual_payments`. Migration: `prisma/migrations/20260822020000_cashier_shifts/migration.sql`. Jalankan `npx prisma migrate deploy && npx prisma generate` setelah pull kode ini.

## `ShiftsService`

- `open(kasirId, openingBalance)` — row-lock shift terbuka milik kasir itu di dalam `$transaction`, tolak (`BadRequestException`) kalau masih ada yang belum ditutup, baru `create`.
- `findOpenShiftForKasir(kasirId)` — dipakai internal oleh `PaymentsService`.
- `findMyOpenShift(kasirId)` — alias yang sama, dipakai endpoint `GET /shifts/current` (ditambahkan buat frontend uji-coba, di luar draft awal, biar kasir bisa cek shift aktifnya sendiri tanpa nyimpen `shiftId` manual di client).
- `close(shiftId, actorId, closingBalance, notes?)` — validasi kepemilikan + belum ditutup, hitung `expectedCash` (`SUM(amount)` method `tunai`, tanpa filter status karena memang gak ada), `selisih = closingBalance - (openingBalance + expectedCash)`.
- `report(shiftId, actor)` — kasir cuma boleh liat shift miliknya sendiri, admin boleh liat semua; breakdown `perMethod` (total + jumlah transaksi) dan `jumlahInvoiceDilayani` (unique invoice).

## Endpoint

| Endpoint | Role | Keterangan |
|---|---|---|
| `POST /shifts/open` | kasir | `{ openingBalance }` |
| `GET /shifts/current` | kasir | shift terbuka milik sendiri, `null` kalau gak ada punya (baru, buat frontend) |
| `POST /shifts/:id/close` | kasir | `{ closingBalance, notes? }` → `{ closingBalance, expectedCash, selisih }` |
| `GET /shifts/:id/report` | semua role login | di-gate di service, bukan `@Roles()` |

## Reuse — endpoint Siklus 1 yang TIDAK berubah kontraknya

`POST /invoices/:id/payments` tetap sama signature-nya untuk caller — `shiftId` cuma muncul sebagai field baru yang keisi otomatis di baris `manual_payments`, gak ada breaking change buat frontend yang sudah terintegrasi.

---

## Kondisi implementasi saat ini

Semua di atas sudah dibangun dan jalan. Belum ada UI frontend uji-coba untuk siklus ini — menyusul.

**Belum dibangun (sesuai scope):** laporan lintas-shift/harian gabungan semua kasir (Siklus 8), approval/reconciliation selisih kas oleh admin (kolom `notes` sudah ada, cukup diisi manual dulu).
