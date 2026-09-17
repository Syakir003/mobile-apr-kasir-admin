# E-POS AC — Siklus 5 (revisi): Checklist Temuan Servis + Review Admin (Backend NestJS)

> **Status: PLAN — belum dicoding.** Dokumen ini MENGGANTIKAN isi lama `2026-08-20-siklus-retur-refund.md` sebagai "Siklus 5" dalam roadmap. Retur/refund TETAP fitur nyata (dikonfirmasi ada di `requirementepos 2.md` §3 Kasir), tapi dipindah jadi siklus terpisah belakangan — bukan hilang, cuma gak lagi disebut "Siklus 5". Alasan revisi: `requirementepos 2.md` (dokumen requirement yang lebih otoritatif, diunggah user 2026-08-22) mengonfirmasi ada 2 hal yang TIDAK ADA di implementasi Siklus 1 & 2 yang sudah jalan sekarang: (1) sistem checklist assignment (§3 Admin: "Assign checklist pekerjaan servis ke Teknisi"; §3 Teknisi: "Update status pekerjaan per checklist"), dan (2) verifikasi pembayaran manual sebelum diterapkan ke invoice (§5 "Verifikasi Pembayaran Manual"). Dokumen ini HANYA membahas #1 (checklist). #2 (verifikasi pembayaran) sengaja BELUM diputuskan — lihat bagian "Isu Terbuka" di bawah, jangan mulai coding bagian itu sebelum ada keputusan eksplisit dari user.

**Goal:** Job teknisi (baik dari instalasi Siklus 1 maupun servis masuk mandiri Siklus 2) punya daftar **temuan masalah** dinamis (bukan template tetap) — masing-masing dengan judul (autocomplete dari kategori baku atau ketik bebas jadi kategori baru) dan foto sebelum/sesudah (boleh banyak). Teknisi mengajukan job selesai (`submitForReview`), lalu **Admin** yang mengecek hasil kerja dan menandai benar-benar selesai (`approveComplete`) — atau mengembalikan ke teknisi kalau belum beres (`sendBack`). Ini menggantikan model lama di mana teknisi sendiri yang menutup job (`complete()`), dan menggantikan foto level-job (`JobPhoto.kind` sebelum/sesudah global) jadi foto per-temuan.

---

## Kenapa ini bukan "checklist tetap dicentang satu-satu"

Draf pertama saya (mockup ilustrasi) salah — saya kira checklist itu daftar langkah tetap (misal "cek tekanan freon", "cuci unit indoor", dst) yang tinggal dicentang. User mengoreksi: modelnya **dinamis**, dibedakan 2 konteks:

1. **Komplain customer (servis masuk mandiri / perbaikan):** Admin input komplain saat intake → otomatis jadi **temuan #1** di job itu. Teknisi kerjain, upload foto. Kalau di lapangan ketemu masalah LAIN yang gak disebut di komplain awal, teknisi **nambah temuan baru** (judul + foto sendiri) — jadi bisa lebih dari 1 temuan per job.
2. **Servis rutin (cuci berkala, dll — tanpa komplain spesifik):** Job dibuat kosong (gak ada temuan otomatis) — teknisi cuma tau AC yang mana, di mana, punya siapa. Begitu teknisi mendiagnosa di lokasi, **dia sendiri yang mengisi temuan** (kategori masalah/jenis servis + foto), bisa 1 atau banyak.

Jadi "checklist" di sini = daftar temuan yang bisa nambah sendiri (baik dari sistem waktu intake, maupun manual oleh teknisi), BUKAN template yang sudah ditentuin di awal dan tinggal dicentang.

---

## Model Data Baru

### `ProblemCategory` (kategori masalah/jenis servis — daftar baku yang tumbuh sendiri)

```prisma
// Daftar baku "kemungkinan kerusakan / jenis servis AC" buat autocomplete input
// temuan. Tumbuh sendiri: kalau teknisi ketik judul yang belum ada di daftar,
// otomatis kebentuk row baru di sini (pola sama seperti MembersService.findOrCreate).
model ProblemCategory {
  id        String   @id @default(uuid())
  name      String   @unique
  source    String   // 'seed' (diisi manual awal) | 'auto' (kebentuk dari input teknisi)
  createdAt DateTime @default(now()) @map("created_at")

  findings JobFinding[]

  @@map("problem_categories")
}
```

Seed awal (contoh, bukan daftar final — Admin bisa nambah manual juga lewat endpoint yang sama dipakai auto-create): "AC tidak dingin", "Freon bocor/kurang", "Kompresor rusak", "Cuci unit indoor", "Cuci unit outdoor", "Pemasangan baru", "Kebocoran air (drain mampet)", "Remote/PCB error", "Ganti kapasitor", "Noise/getaran tidak normal".

### `JobFinding` (temuan masalah — pengganti konsep "checklist item")

```prisma
// Satu temuan masalah dalam satu job. Job pemasangan/servis bisa punya 0 (saat
// baru dibuat, sebelum teknisi diagnosa) sampai banyak JobFinding.
model JobFinding {
  id           String          @id @default(uuid())
  jobId        String          @map("job_id")
  job          TechnicianJob   @relation(fields: [jobId], references: [id])
  categoryId   String          @map("category_id")
  category     ProblemCategory @relation(fields: [categoryId], references: [id])
  // Judul final yang ditampilkan (bisa beda kecil dari category.name kalau user
  // edit dikit sebelum submit — tapi biasanya sama). Disimpan supaya history
  // tetap utuh walau category.name diubah admin belakangan.
  title        String
  note         String?
  // 'komplain_awal' -> otomatis dibuat dari ServiceOrder.note saat intake;
  // 'ditambah_teknisi' -> teknisi nambah sendiri di lapangan.
  origin       String
  createdById  String          @map("created_by")
  createdBy    User            @relation("FindingCreatedBy", fields: [createdById], references: [id])
  createdAt    DateTime        @default(now()) @map("created_at")

  photos JobFindingPhoto[]

  @@map("job_findings")
}
```

### `JobFindingPhoto` (pengganti `JobPhoto` level-job untuk konteks servis)

```prisma
// Foto sebelum/sesudah PER TEMUAN — bukan lagi per job. Boleh banyak per kind
// (user eksplisit: "sebelum dan sesudah, namun bisa banyak foto, jangan hanya 1").
model JobFindingPhoto {
  id           String     @id @default(uuid())
  findingId    String     @map("finding_id")
  finding      JobFinding @relation(fields: [findingId], references: [id])
  kind         String     // 'sebelum' | 'sesudah'
  path         String
  uploadedById String     @map("uploaded_by")
  uploadedBy   User       @relation("FindingPhotoUploadedBy", fields: [uploadedById], references: [id])
  createdAt    DateTime   @default(now()) @map("created_at")

  @@map("job_finding_photos")
}
```

`JobPhoto` (model lama, level-job) **tidak dihapus** dari schema — biar data lama (kalau ada job yang sudah pakai foto level-job sebelum migrasi ini) tetap kebaca — tapi berhenti dipakai untuk job baru. Endpoint lama `POST /technician-jobs/:id/photos` di-deprecate, diganti `POST /technician-jobs/:id/findings/:findingId/photos`.

### `TechnicianJob.status` — vokabuler baru

Lama: `menunggu_penugasan → assigned → sedang_dikerjakan → selesai / dibatalkan`

Baru: `menunggu_penugasan → assigned → sedang_dikerjakan → menunggu_review → selesai / dibatalkan`, plus jalur balik `menunggu_review → sedang_dikerjakan` (lewat `sendBack`).

Tidak ada kolom baru di `TechnicianJob` untuk status ini — cukup nilai string baru, sama seperti pola status lain di proyek ini.

---

## Alur Endpoint Baru/Berubah (`technician-jobs/`)

| Endpoint | Role | Perubahan |
|---|---|---|
| `POST /technician-jobs/:id/start` | teknisi/admin | **Tidak berubah** — gate tetap scan barcode cocok + (opsional, lihat catatan) foto sebelum. Karena foto sekarang per-temuan, gate "foto sebelum" di sini diubah jadi: **tidak lagi gate di level start** — cukup barcode cocok. Foto sebelum/sesudah sekarang jadi syarat di level temuan masing-masing, dicek nanti di `submitForReview`. |
| `GET /technician-jobs/:id/categories/search?q=` | teknisi | **BARU** — autocomplete `ProblemCategory`, pola sama persis `SparepartsController.search()`. |
| `POST /technician-jobs/:id/findings` | teknisi/admin | **BARU** — tambah temuan baru. Body: `{ categoryId? , categoryName?, note? }`. Kalau `categoryId` diisi → pakai kategori itu. Kalau `categoryName` diisi dan gak cocok kategori manapun (case-insensitive) → auto-create `ProblemCategory` baru (`source: 'auto'`), sama pola `findOrCreate`. Salah satu wajib diisi. |
| `POST /technician-jobs/:id/findings/:findingId/photos` | teknisi/admin | **BARU** (ganti `POST /technician-jobs/:id/photos`) — upload foto ke temuan tertentu, `kind: 'sebelum' | 'sesudah'`, bisa dipanggil berkali-kali per kind (tidak ada gate "cuma 1"). |
| `POST /technician-jobs/:id/submit-for-review` | teknisi/admin | **BARU** (ganti sebagian besar peran `complete()` lama) — job harus `sedang_dikerjakan`. Gate: minimal 1 `JobFinding` ada di job ini, dan setiap `JobFinding` yang ada minimal punya 1 foto `sebelum` DAN 1 foto `sesudah` (supaya admin ada dasar visual buat review), TIDAK ada `MaterialRequest` berstatus `pending`, semua yang `approved` sudah `usedAt` terisi. Transisi ke `menunggu_review`. |
| `POST /technician-jobs/:id/approve-complete` | **admin only** | **BARU** — job harus `menunggu_review`. Tidak ada gate otomatis tambahan (review visual admin ITU gate-nya, sesuai keputusan user: "admin cek hasil pekerjaan teknisi ... admin bisa mengklik menandai tugas selesai"). Transisi ke `selesai` — efek samping sama seperti `complete()` lama (update `ServiceOrderUnit.status`, `MemberAcUnit` next-service-date, tutup `ServiceOrder` kalau semua job-nya beres). |
| `POST /technician-jobs/:id/send-back` | **admin only** | **BARU** — job harus `menunggu_review`. Body: `{ note: string }` (wajib, disimpan ke `TechnicianJob.notes` atau field baru `reviewNote` — lihat catatan implementasi). Transisi balik ke `sedang_dikerjakan`. Teknisi bisa nambah/lengkapi temuan lagi lalu `submit-for-review` ulang. |
| `POST /technician-jobs/:id/photos` (lama) | — | **Dihapus/deprecated.** Kalau ada kebutuhan kompatibilitas mundur, bisa dipertahankan sementara sebagai alias yang otomatis bikin 1 `JobFinding` generik "Lain-lain" — tapi defaultnya dihapus langsung karena belum ada consumer produksi (frontend tes juga perlu diupdate). |

**Catatan implementasi field note review:** perlu 1 kolom baru di `TechnicianJob`, misal `reviewNote String?` — diisi admin saat `send-back`, ditampilkan ke teknisi supaya tau apa yang kurang. Dikosongkan lagi (`null`) setiap kali `submit-for-review` dipanggil ulang (biar gak nyangkut catatan lama).

---

## Perubahan ke Intake (Siklus 1 & 2)

- `PosService` (checkout instalasi, Siklus 1) dan `ServiceOrdersService.intake()` (Siklus 2) — titik yang sekarang manggil `TechnicianJobsService.createForOrder()` — perlu tambahan langkah: **kalau ada `complaint`/keluhan yang diinput** (servis masuk mandiri selalu ada; instalasi baru biasanya tidak ada keluhan spesifik), otomatis buat 1 `JobFinding` dengan `origin: 'komplain_awal'`, `title` = isi komplain, `categoryId` = hasil `findOrCreateCategory(complaint)` (kalau teksnya persis cocok kategori baku, dipakai; kalau enggak, auto-create kategori baru dari teks itu).
- Untuk instalasi murni (job `type: 'pemasangan'`, tidak ada keluhan) — tidak ada `JobFinding` otomatis. Sesuai keputusan user soal "servis rutin": teknisi baru ngisi temuan sendiri pas di lokasi (untuk instalasi, ini biasanya cuma dipakai kalau ada catatan tambahan; instalasi sendiri sebenarnya lebih dekat ke "servis rutin" karena kerjanya sudah jelas dari order, bukan diagnosa masalah — jadi buat instalasi, submit-for-review tetap butuh minimal 1 `JobFinding` juga, teknisi bisa isi manual misal "Pemasangan unit — instalasi selesai" + foto sebagai bukti kerja kalau memang tidak ada temuan masalah).

## Dampak ke Kode yang Sudah Jalan

- `TechnicianJobsService.complete()` — **dipecah** jadi `submitForReview()` (teknisi) + `approveComplete()` (admin) + `sendBack()` (admin, baru).
- `TechnicianJobsService.addPhoto()` — **diganti** `addFindingPhoto(jobId, findingId, ...)`, sekarang butuh `findingId`.
- `TechnicianJobsService.start()` — gate foto-sebelum di level start **dihapus** (foto sekarang per-temuan, gate pindah ke `submitForReview`).
- `TechnicianJob` relasi: tambah `findings JobFinding[]`.
- `JobPhoto` — tetap ada di schema untuk data historis, berhenti dipakai untuk alur baru.
- Migration Prisma baru: `problem_categories`, `job_findings`, `job_finding_photos` tables + kolom `technician_jobs.review_note`.
- Frontend tes (`epos-backend/frontend/`) — perlu update halaman job teknisi: form tambah temuan (dengan autocomplete kategori), upload foto per temuan, tombol "Ajukan Selesai" (ganti "Selesaikan"), dan halaman admin baru untuk review (lihat semua temuan + foto job yang `menunggu_review`, tombol "Setujui"/"Kembalikan").

---

## Isu Terbuka — BELUM DIPUTUSKAN, JANGAN DIKERJAKAN DULU

`requirementepos 2.md` §5 "Verifikasi Pembayaran Manual" mengharuskan: pembayaran servis/penjualan **tidak langsung apply** ke invoice begitu diinput kasir — customer transfer manual → kasir lihat bukti transfer → **kasir baru meng-acc** transaksi. Ini beda dari `PaymentsService.record()` yang sudah jalan sekarang (langsung apply, tanpa verifikasi terpisah), yang sudah benar mengikuti RPC `record_payment` di SQL Supabase asli.

Ini konflik nyata antara dokumen requirement (lebih baru, lebih otoritatif) vs. implementasi yang sudah di-ship. Belum ada keputusan dari user soal:
1. Apakah alur verifikasi ini mau diterapkan sekarang (mengubah `PaymentsService`), atau ditunda ke siklus lain?
2. Kalau diterapkan: apakah berlaku untuk SEMUA metode pembayaran (termasuk cash langsung di kasir, yang sebenarnya gak butuh "verifikasi bukti transfer" karena kasir sendiri yang pegang uangnya), atau cuma untuk transfer bank/e-wallet?

Jangan mulai coding bagian ini sampai user menjawab eksplisit — dicatat di sini biar gak kelupaan, bukan buat diasumsikan.

---

## Ringkasan Perubahan vs. Draft Lama (`2026-08-20-siklus-retur-refund.md`)

Draft lama mengira "Siklus 5" = Retur/Refund, dan sempat disangka fiktif (tidak ada di 9 file SQL migration maupun kode mobile app yang tersedia saat itu). Setelah user upload `requirementepos 2.md`, terkonfirmasi retur/refund itu requirement asli (§3 Kasir: "Retur/refund barang") — jadi BUKAN dihapus, cuma dipindah keluar dari slot "Siklus 5" karena checklist+review ternyata masalah yang lebih mendesak (langsung berdampak ke kode Siklus 1 & 2 yang sudah jalan). Retur/Refund akan dapat nomor siklus sendiri belakangan; isi teknis draft lama (model `Return`/`ReturnItem`, validasi anti-double-return via `SUM(return_items.qty)`, dst) tetap relevan dan akan dipakai ulang saat waktunya tiba — cuma perlu dikoreksi dulu `cuid()`→`uuid()`, `createdBy`→`createdById`, dan pakai `StockLockingService.lockAndAdd` yang sudah ada (bukan bikin fallback inline baru).
