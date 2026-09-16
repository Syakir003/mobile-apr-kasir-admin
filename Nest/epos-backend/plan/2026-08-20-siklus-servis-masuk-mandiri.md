# E-POS AC — Siklus 2: Servis Masuk Mandiri (Backend NestJS)

> **Status: SUDAH DIIMPLEMENTASI.** Dokumen ini awalnya plan sebelum coding, dan mengasumsikan ada tabel checklist per job (`technician_job_checklist_items`) — itu SALAH, sistem ini gak punya tabel checklist sama sekali (lihat koreksi di dokumen Siklus 1). Dokumen ini sudah di-rewrite jadi catatan "as-built", sama persis dengan kode yang jalan di `epos-backend/src/service-orders/` sekarang.

**Goal:** Jalur masuk servis yang **gak lewat `pos/checkout`** — Kasir terima customer yang datang bawa AC lama buat diperbaiki (bukan beli produk baru), input keluhan + data unit (existing via scan barcode, atau unit yang belum pernah tercatat sama sekali), assign ke Teknisi (opsional, bisa nyusul), Kasir bisa cek status servis pelanggan kapan aja, dan Teknisi bisa lihat riwayat job yang udah dia kerjakan.

**Architecture:** Modul `service-orders/` di monolith NestJS yang sama dengan Siklus 1. Reuse total ke `MembersService`, `AcUnitsService`, `CountersService`, `TechnicianJobsService`, `RealtimeGateway` — semua sudah `@Global()` atau tinggal di-import module-nya, gak ada logic job/checklist baru yang ditulis ulang.

---

## Koreksi dari draft awal

1. **Tidak ada `createJobWithChecklist`.** Draft awal minta method ini bikin job + N baris checklist. Yang beneran dibangun: `TechnicianJobsService.createForOrder(tx, params)` — bikin job aja (status otomatis dari ada/gaknya `technicianId`), TANPA parameter checklist labels, karena gak ada tabelnya. Method ini dipakai bareng oleh `PosService` (Siklus 1, refactor dari inline jadi manggil method ini) dan `ServiceOrdersService` (siklus ini).
2. **Konflik `technician_id NOT NULL`** yang jadi concern utama draft awal **sudah kelar** — kolom itu emang udah dibikin nullable dari sononya (`schema.prisma` kita sendiri, independen dari skema Supabase asli), jadi Fase 0 (migration) di draft awal **tidak diperlukan lagi**, sudah beres duluan sebelum siklus ini dikerjakan.
3. **Status unit AC hasil intake** pakai vokabuler real (`aktif`), bukan `terpasang` seperti di draft awal — `terpasang` bukan nilai yang dipakai di mana pun di kode.

## Keputusan desain yang dipakai (defaultnya sesuai draft awal, sudah jalan)

1. **Data teknis unit AC yang belum pernah tercatat (brand/model/PK/serial number) boleh kosong/seadanya dari kasir** — semua field di `newUnit` optional. Teknisi bisa lengkapi lewat `PATCH /technician-jobs/:id/notes` (field bebas teks) kalau perlu, TIDAK ada endpoint `PATCH /ac-units/:id` terpisah (di luar scope, belum dibangun).
2. **Unit existing yang ternyata terdaftar atas nama member lain** → ditolak dengan error eksplisit (`BadRequestException`), bukan otomatis pindah kepemilikan. Kasir harus klarifikasi manual ke customer.
3. **Belum ada invoice otomatis dari servis mandiri** — kalau perbaikan ini berbayar (misal ganti sparepart), penagihannya di luar scope siklus ini (belum diputuskan apakah tiap `service_orders` type `perbaikan` otomatis bikin invoice, atau dibuat manual belakangan lewat `pos/checkout` terpisah).

## Struktur file (`src/service-orders/` + modifikasi kecil ke modul lain)

```
src/
  service-orders/
    service-orders.module.ts
    service-orders.controller.ts
    service-orders.service.ts
    dto/service-intake.dto.ts
  ac-units/
    ac-units.service.ts         → tambah registerExisting()
  technician-jobs/
    technician-jobs.service.ts  → tambah createForOrder() (dipakai bareng pos.service.ts) & history()
    technician-jobs.controller.ts → tambah GET /technician-jobs/history
    dto/history-query.dto.ts    → baru
  pos/
    pos.service.ts              → dirombak pakai createForOrder(), hapus duplikasi inline create job
    pos.module.ts                → tambah import TechnicianJobsModule
  app.module.ts                  → daftarin ServiceOrdersModule
```

Tidak ada migration baru untuk siklus ini (`technician_id` sudah nullable dari Siklus 1).

## `AcUnitsService.registerExisting()`

```ts
async registerExisting(
  tx: Prisma.TransactionClient,
  memberId: string,
  data: { brand?: string; model?: string; pk?: number; roomLocation?: string; serialNumber?: string },
)
```
Beda dari `createForInstallation()`: status langsung `'aktif'` (unit ini sudah lama terpasang di rumah customer, bukan baru mau dipasang toko ini). Tetap pakai `CountersService` dengan namespace key **sama** (`acunit_${dateKey}`) dengan `createForInstallation`, jadi format `barcodeValue` identik dan `lookupByBarcode` (Siklus 1) langsung jalan tanpa modifikasi apa pun buat unit hasil intake ini.

## `ServiceOrdersService`

- `intake(dto, actorId)`:
  1. Validasi: isi `existingUnitId` XOR `newUnit` (harus salah satu, gak boleh dua-duanya/kosong dua-duanya).
  2. `MembersService.findOrCreate` — customer lama otomatis kedetek dari nomor HP, gak dobel.
  3. Kalau `existingUnitId`: ambil unit, tolak kalau `unit.memberId !== member.id`.
  4. Kalau `newUnit`: `AcUnitsService.registerExisting` + increment `member.totalAcUnits`.
  5. Buat `ServiceOrder` (`type: 'perbaikan'`, `status: 'terjadwal'`, `note: complaint`, `scheduledDate` opsional).
  6. Buat `ServiceOrderUnit` (`status: 'terjadwal'`).
  7. `TechnicianJobsService.createForOrder` (`type: 'perbaikan'`, `technicianId` opsional).
  8. `AuditLog` (`action: 'service_order.intake'`).
  9. Return `{ serviceOrderId, memberId, unitId, barcodeValue, jobId, jobStatus }`.
- `findByCustomer({ phone?, memberId? })` — normalisasi nomor HP (`MembersService.normalizePhone`), cari `member`, lalu `ServiceOrder.findMany` include `serviceOrderUnits.unit` dan `units` (relasi balik `TechnicianJob[]` dari `ServiceOrder`, dengan `technician` di-select `id`+`displayName`).

Endpoint: `POST /service-orders/intake` (admin, kasir), `GET /service-orders?phone=` atau `?memberId=` (admin, kasir).

## Reuse eksplisit — endpoint yang TIDAK dibikin baru di siklus ini

Semua ini dari Siklus 1, langsung jalan buat job `type='perbaikan'` tanpa modifikasi, karena logic-nya gak digating berdasarkan `type`:

| Kebutuhan | Endpoint yang direuse |
|---|---|
| Assign/ganti teknisi setelah intake | `PATCH /technician-jobs/:id/assign` |
| Diagnosa & catatan teknis | `PATCH /technician-jobs/:id/notes` |
| Antrian aktif teknisi (termasuk job perbaikan) | `GET /technician-jobs/queue` |
| Upload foto sebelum/sesudah | `POST /technician-jobs/:id/photos` |
| Sparepart tambahan buat perbaikan | `POST /technician-jobs/:id/materials` + `GET /spareparts/search` |
| Mulai (scan barcode) & selesaikan job | `PATCH /technician-jobs/:id/start` / `/complete` |
| Scan barcode unit hasil intake buat kunjungan servis berikutnya | `GET /ac-units/lookup/:barcodeValue` |

## `TechnicianJobsService.history()` (ditambahkan siklus ini)

```ts
async history(technicianId: string, page: number, pageSize: number)
```
`GET /technician-jobs/history` (role teknisi), `technicianId` WAJIB dari JWT `sub` (sama seperti `/queue`), query `page`/`pageSize` divalidasi lewat `HistoryQueryDto`. Route statis `history` didaftarkan SEBELUM route dinamis `:id` di controller, biar Nest gak nyangka `history` itu value `:id`.

---

## Kondisi implementasi saat ini

Semua di atas sudah dibangun dan jalan. Frontend uji coba (`epos-backend/frontend/`) sudah punya tab **Servis Mandiri**: form terima servis (unit baru / scan unit lama), cek status servis by nomor HP, dan riwayat servis teknisi.

**Belum dibangun:** penagihan otomatis dari servis mandiri (lihat keputusan desain #3 di atas), transfer kepemilikan unit antar member.
