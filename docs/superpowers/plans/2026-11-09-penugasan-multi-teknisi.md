# Penugasan Beberapa Teknisi + Deteksi Teknisi Sibuk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu job bisa ditugaskan ke beberapa teknisi setara, dan admin/kasir diperingatkan saat memilih teknisi yang sedang mengerjakan job lain (web + mobile + backend).

**Architecture:** Tabel baru `technician_job_assignees` menyimpan SEMUA teknisi per job; kolom lama `technician_jobs.technician_id` dipertahankan = teknisi pertama (kode lama/APK lama tetap jalan). Semua guard akses dan query teknisi pindah ke keanggotaan assignees lewat satu modul helper. Endpoint `GET /technician-jobs/workload` memberi data sibuk; web & mobile memakai satu komponen pilih-banyak-teknisi dengan dialog peringatan.

**Tech Stack:** NestJS + Prisma (Postgres) + Jest; Next.js (React Query, shadcn); Flutter (Riverpod).

**Spec:** `docs/superpowers/specs/2026-11-09-penugasan-multi-teknisi-design.md`

## Global Constraints

- Maksimal **5** teknisi per job; tiap id harus user `role='teknisi'` dan `active`; tanpa duplikat (400 bila melanggar).
- Teknisi sibuk = punya job berstatus `sedang_dikerjakan` (bukan `assigned`, bukan `menunggu_review`). Tetap boleh dipilih; hanya peringatan.
- `technician_jobs.technician_id` SELALU = teknisi pertama di assignees (atau null bila kosong). Respons job tetap memuat `technicianId`, ditambah `technicianIds: string[]` dan `technicians: {id, displayName}[]`.
- Field request lama `technicianId` tetap diterima (= daftar berisi satu); `technicianIds` menang bila dua-duanya ada.
- Laporan performa teknisi menghitung job bersama untuk SEMUA teknisi; total per status/rata-rata waktu tetap per job.
- Teks UI Bahasa Indonesia. Commit tanpa trailer Co-Authored-By. Migrasi DB tidak dijalankan ke VPS oleh agen (deploy lewat skrip oleh pemilik).
- Aturan status saat assign (keputusan saya, spec diam): status direset ke `assigned` (wajib scan ulang) HANYA bila job `sedang_dikerjakan` dan set baru sama sekali tidak beririsan dengan set lama; menambah/mengurangi sebagian tidak mereset. `menunggu_review` tidak pernah direset. Assign pada job `sedang_dikerjakan`/`menunggu_review` tetap hanya admin.

## Review Focus

- Teknisi yang BUKAN assignee memanggil start/temuan/foto/material/ajukan-selesai → 403 (Task 2).
- Dua assignee menekan "Mulai" hampir bersamaan: yang kedua tidak error 500 dan tidak transisi ganda (Task 2).
- `technicianIds` berisi duplikat, >5, id bukan teknisi, atau teknisi nonaktif → 400, tidak ada baris tersimpan (Task 1, 4).
- APK lama mengirim hanya `technicianId` dan membaca hanya `technicianId` → tetap berfungsi (Task 3, 4).
- Teknisi memanggil `GET /technician-jobs/workload` → 403; respons tanpa data harga/finansial (Task 5).
- Unit tambahan (`addUnit`) dan job komplain mewarisi SEMUA assignee aktif, bukan hanya teknisi pertama (Task 3).

## File Structure

- Create: `Nest/epos-backend/prisma/migrations/20261109000000_job_assignees/migration.sql`
- Create: `Nest/epos-backend/src/technician-jobs/job-assignees.ts` (helper tunggal)
- Create: `Nest/epos-backend/src/technician-jobs/technician-jobs.assignees.spec.ts`, `technician-jobs.workload.spec.ts`
- Modify: `prisma/schema.prisma`, `technician-jobs.service.ts`, `technician-jobs.controller.ts`, `offline-sync.service.ts`, `material-requests.service.ts`, `ac-units.service.ts`, `reports.service.ts`, `service-orders.service.ts`, `pos.service.ts`, DTO `assign-job.dto.ts`, `service-intake.dto.ts`, `create-service-order.dto.ts`, `pos/dto/checkout.dto.ts`, `create-complaint.dto.ts` (semua di `Nest/epos-backend/src/...`)
- Create (web): `Nest/epos-frontend-web/src/components/technician-multi-picker.tsx`
- Modify (web): `service-orders/intake/intake-client.tsx`, `teknisi/jobs/[id]/handover.tsx`, `teknisi/jobs/[id]/complaint-dialog.tsx`, `teknisi/queue/queue-client.tsx`, `teknisi/jobs/[id]/job-detail-client.tsx` (tampilkan semua nama)
- Create (mobile): `frontend/mobile/lib/features/jobs/technician_multi_picker.dart`
- Modify (mobile): `data/models/technician_job.dart`, `data/repositories/job_repository.dart`, `features/jobs/job_providers.dart`, `job_requests_section.dart`, `job_detail_screen.dart`, `service_order_create_screen.dart`, `features/pos/{cart_state,pos_providers,checkout_screen}.dart`

---

### Task 1: Skema, migrasi, dan modul helper assignees

**Files:** Modify `prisma/schema.prisma`; Create migrasi, `job-assignees.ts`, `technician-jobs.assignees.spec.ts`.

**Interfaces — Produces** (`job-assignees.ts`):
- `const MAX_ASSIGNEES = 5`
- `normalizeTechnicianIds(src: { technicianIds?: string[]; technicianId?: string | null }): string[]` — `technicianIds` menang; kalau tidak ada pakai `[technicianId]`; buang kosong & duplikat, urutan dipertahankan.
- `assertValidTechnicians(db: { user: { findMany } }, ids: string[]): Promise<void>` — `BadRequestException('Teknisi tidak valid atau tidak aktif')`; `>5` → `BadRequestException('Maksimal 5 teknisi per job')`.
- `setJobAssignees(tx: Prisma.TransactionClient, jobId: string, ids: string[]): Promise<void>` — ganti seluruh baris assignees job itu dan set `technicianId = ids[0] ?? null`.
- `isJobAssignee(db: { technicianJobAssignee: { count } }, jobId: string, userId: string): Promise<boolean>`
- `assignedTo(userId: string): Prisma.TechnicianJobWhereInput` = `{ assignees: { some: { technicianId: userId } } }`

- [ ] **Step 1: Skema.** Tambah `model TechnicianJobAssignee { jobId, technicianId, createdAt; @@id([jobId, technicianId]); @@index([technicianId]); @@map("technician_job_assignees") }` dengan relasi ke `TechnicianJob` (`onDelete: Cascade`) dan `User`; tambah `assignees TechnicianJobAssignee[]` di `TechnicianJob` dan di `User`.
- [ ] **Step 2: Migrasi** `20261109000000_job_assignees/migration.sql`: `CREATE TABLE`, FK, indeks, lalu backfill `INSERT INTO technician_job_assignees (job_id, technician_id, created_at) SELECT id, technician_id, now() FROM technician_jobs WHERE technician_id IS NOT NULL;`. Jalankan `npx prisma generate` (jangan `migrate deploy` ke VPS).
- [ ] **Step 3: Tes gagal dulu** di `technician-jobs.assignees.spec.ts`: `normalizeTechnicianIds({technicianId:'a'})` → `['a']`; `({technicianIds:['a','b','a'], technicianId:'z'})` → `['a','b']`; `({})` → `[]`; `assertValidTechnicians` menolak 6 id, id yang tidak ditemukan, user `active:false`, user `role:'kasir'`; `setJobAssignees(tx,'j1',['b','a'])` memanggil `deleteMany({where:{jobId:'j1'}})`, `createMany` 2 baris, dan `technicianJob.update` dengan `technicianId:'b'`; `[]` → `technicianId:null`.
- [ ] **Step 4:** Jalankan `npx jest technician-jobs.assignees` → FAIL (modul belum ada). Implementasikan `job-assignees.ts`, jalankan lagi → PASS.
- [ ] **Step 5: Commit** `feat(backend): tabel assignees job + helper`.

### Task 2: Guard akses & query teknisi berbasis assignees

**Files:** Modify `technician-jobs.service.ts`, `offline-sync.service.ts`, `material-requests.service.ts`, `ac-units.service.ts`; Test `technician-jobs.assignees.spec.ts`.

**Interfaces — Consumes:** `isJobAssignee`, `assignedTo` (Task 1). **Produces:** `assertOwnerOrAdmin(job: { id: string }, actorId, role): Promise<void>` kini **async** (non-admin: 403 `'Job ini bukan milik Anda'` bila bukan assignee).

- [ ] **Step 1: Tes gagal dulu:** (a) assignee kedua (`t2`) lolos `start`/`addFinding`/`submitForReview` pada job yang `technicianId='t1'`; (b) non-assignee `t9` → `ForbiddenException`; (c) admin selalu lolos; (d) `mine('t2')`, `myQueue('t2')`, `todayBundle('t2')`, `history('t2',1,20)` memakai `where` berisi `assignees: { some: { technicianId: 't2' } }`; (e) `start` oleh assignee ketika status sudah `sedang_dikerjakan` mengembalikan job apa adanya (idempoten), tanpa `update`.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3: Ubah `assertOwnerOrAdmin`** jadi async (query `isJobAssignee`) dan tambahkan `await` di semua 12 pemanggilnya (`grep -n assertOwnerOrAdmin technician-jobs.service.ts`). Ganti filter `technicianId` dengan `...assignedTo(id)` di `mine`, `myQueue`, `todayBundle`, `history` (findMany + count), pembatasan saudara order di `findOne` (~baris 389-406), dan `unitLabels` (~746). `findOne`: tolak teknisi bila bukan assignee. Sertakan `assignees: { include: { technician: { select: { id, displayName } } } }` pada `findOne`/`mine`/`myQueue`/`todayBundle`/`findAll` dan petakan hasilnya ke `technicianIds` + `technicians` (satu fungsi privat `withAssignees(job)`).
- [ ] **Step 4: Guard lain:** `offline-sync.service.ts` (~84) ganti `job.technicianId !== technicianId` dengan `!(await isJobAssignee(...))`; `material-requests.service.ts` (~147 dan ~363) sama; `ac-units.service.ts` (~487) bangun `ownIds` dari job yang assignee-nya memuat `actor.sub` (tambah `assignees: { select: { technicianId: true } }` pada query jobnya).
- [ ] **Step 5: `start()` idempoten:** setelah cek kepemilikan, bila `job.status === sedang_dikerjakan` kembalikan `job` tanpa perubahan (lakukan sebelum cek "harus Ditugaskan"). Periksa tes `start` lama yang mengharapkan error pada status itu dan sesuaikan.
- [ ] **Step 6:** `npx jest` (seluruh backend) → PASS. **Commit** `feat(backend): guard dan query teknisi berbasis assignees`.

### Task 3: Pembuatan job dengan banyak teknisi (intake, order manual, POS, komplain, tambah unit)

**Files:** Modify `technician-jobs.service.ts` (`createForOrder`, `addUnit`, `createComplaint`), `service-orders.service.ts` (`createManual`, `intake`), `pos.service.ts` (~777-810), DTO `service-intake.dto.ts`, `create-service-order.dto.ts`, `checkout.dto.ts` (installation), `create-complaint.dto.ts`; Test `technician-jobs.assignees.spec.ts` + perbarui spec lama (`complaint`, `multi-unit`, `add-unit`, `intake`).

**Interfaces — Consumes:** `normalizeTechnicianIds`, `assertValidTechnicians`, `setJobAssignees`. **Produces:** `createForOrder(tx, params)` menerima `technicianIds?: string[]` (selain `technicianId` lama); status `assigned` bila daftar tidak kosong; memanggil `setJobAssignees`. Semua DTO di atas menambah `@IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) technicianIds?: string[]` (komplain: `@IsUUID('all', { each: true })`; `technicianIds: []` = belum ditentukan, sama seperti `technicianId: null` lama).

- [ ] **Step 1: Tes gagal dulu:** `createForOrder` dengan `technicianIds:['a','b']` → job `status:'assigned'`, `technicianId:'a'`, dua baris assignees; dengan `technicianId:'a'` saja (jalur lama) → satu baris; `intake`/`createManual` dengan `technicianIds` duplikat/6 id/id kasir → 400 dan tidak membuat order; `createComplaint` tanpa teknisi di DTO mewarisi SEMUA assignee aktif role teknisi dari job sumber pertama; `addUnit` mewarisi semua assignee job asal.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3: Implementasi.** Di tiap pemanggil: `const ids = normalizeTechnicianIds(dto)`; `await assertValidTechnicians(tx/prisma, ids)` SEBELUM membuat order; teruskan `technicianIds: ids` ke `createForOrder`. Daftar `assignedJobs` di respons memuat `technicianIds` (dipakai `notifyJobsAssigned`, yang kini mengirim notifikasi ke tiap id). `createComplaint`: respons mengembalikan `technicianIds`; controller (Task 4) menotifikasi semuanya.
- [ ] **Step 4:** `npx jest` → PASS; `npx tsc --noEmit -p tsconfig.build.json` bersih. **Commit** `feat(backend): buat job dengan banyak teknisi`.

### Task 4: Assign set-penuh + notifikasi

**Files:** Modify `technician-jobs.service.ts` (`assign`, ~805-913), `technician-jobs.controller.ts` (`assign`, ~150-196, `createComplaint`, ~223-246), `dto/assign-job.dto.ts`; Test `technician-jobs.assignees.spec.ts` (+ perbarui spec `assign` lama).

**Interfaces — Produces:** `assign(jobId: string, technicianIds: string[], opts: { allInOrder?: boolean; actorId: string; role: Role; reason?: string }): Promise<Job & { previousTechnicianIds: string[]; addedTechnicianIds: string[] }>` — `previousTechnicianIds` = teknisi yang keluar (gabungan semua target), `addedTechnicianIds` = yang masuk (gabungan semua target). `AssignJobDto`: `technicianId?: string` (lama) dan `technicianIds?: string[]`; keduanya kosong → 400.

- [ ] **Step 1: Tes gagal dulu** (mock tx seperti `complaint.spec`): assign `['t1','t2']` ke job `menunggu_penugasan` → `assigned`, 2 assignees; menambah `t3` ke job `sedang_dikerjakan` oleh admin → status tetap `sedang_dikerjakan`, `addedTechnicianIds:['t3']`; mengganti penuh `['t1']`→`['t9']` pada `sedang_dikerjakan` → `assigned` + satu `jobHandover.create` + audit `job.handover`; `['t1','t2']`→`['t3']` → `assigned`, TANPA `jobHandover.create`, audit `job.assignees_changed` berisi nama sebelum/sesudah; set sama pada job `sedang_dikerjakan` → 400 `'Job ini sudah dipegang teknisi tersebut'`; kasir pada job `sedang_dikerjakan` → 403; `allInOrder` menerapkan set yang sama ke saudara yang masih bisa dialihkan; `technicianIds:['a','a']`/6 id/nonaktif → 400 tanpa perubahan.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3: Implementasi `assign`** memakai aturan "Global Constraints → Aturan status saat assign". Baca set lama dari tabel assignees (include dalam query job), tulis lewat `setJobAssignees`, kunci order (`FOR UPDATE`) seperti sekarang. Controller: `normalizeTechnicianIds(dto)`; notifikasi `job_assigned` ke setiap `addedTechnicianIds` (judul "Job Dialihkan ke Kamu" bila `previousTechnicianIds` tidak kosong, selain itu "Job Baru Ditugaskan"), `job_handover` ke setiap `previousTechnicianIds`, semua dengan `.catch(() => {})`. `createComplaint`: notifikasi ke tiap id di `result.technicianIds`.
- [ ] **Step 4:** `npx jest` → PASS. **Commit** `feat(backend): assign banyak teknisi`.

### Task 5: Endpoint beban kerja (teknisi sibuk)

**Files:** Modify `technician-jobs.service.ts`, `technician-jobs.controller.ts` (daftarkan `@Get('workload')` SEBELUM `@Get(':id')`); Test `technician-jobs.workload.spec.ts`.

**Interfaces — Produces:** `workload(): Promise<{ technicianId: string; jobs: { jobId: string; customerName: string | null; location: string | null }[] }[]>` — hanya job `sedang_dikerjakan`, hanya assignee yang `active` dan `role='teknisi'`; `location` = `workAddress` job, jika kosong `unit.roomLocation`. Route: `GET /technician-jobs/workload`, `@Roles('admin','kasir')`.

- [ ] **Step 1: Tes gagal dulu:** job `sedang_dikerjakan` dengan 2 assignee → kedua teknisi muncul dengan job yang sama; job `assigned`/`menunggu_review` tidak muncul; teknisi nonaktif tidak muncul; hasil tidak memuat field harga/invoice (assert kunci objek persis `jobId, customerName, location`); metadata `@Roles` pada handler tidak mengandung `'teknisi'` (baca via `Reflect.getMetadata('roles', ...)`, sesuaikan dengan key yang dipakai `Roles` decorator).
- [ ] **Step 2:** Jalankan → FAIL; implementasi (satu `findMany` dengan `select` sempit, kelompokkan di memori); jalankan → PASS.
- [ ] **Step 3: Commit** `feat(backend): endpoint beban kerja teknisi`.

### Task 6: Laporan performa teknisi untuk semua assignee

**Files:** Modify `reports.service.ts` (`service()`, query `byTechnician` ~117-125); Test `reports.service.spec.ts` (buat bila belum ada, ikuti pola mock `prisma.$queryRaw` spec lain).

- [ ] **Step 1: Tes gagal dulu:** `service()` memanggil `$queryRaw` dengan SQL yang mengandung `technician_job_assignees`, dan memetakan baris `{technician_id, display_name, completed_count:'3'}` menjadi `{technicianId, namaTeknisi, jobSelesai:3}`.
- [ ] **Step 2:** Ubah query: `FROM technician_job_assignees a JOIN technician_jobs tj ON tj.id = a.job_id JOIN users u ON u.id = a.technician_id`, filter/GROUP BY pakai `a.technician_id`. Query status & rata-rata waktu TIDAK diubah. Jalankan tes → PASS; `npx jest` penuh → PASS. **Commit** `feat(backend): laporan performa menghitung semua teknisi`.

### Task 7: Web — komponen pilih banyak teknisi + peringatan sibuk

**Files:** Create `components/technician-multi-picker.tsx`; Modify `intake-client.tsx` (state `technicianId` ~173 → `technicianIds: string[]`, kirim `technicianIds` ~385, dropdown ~782), `handover.tsx` (pilihan banyak, `currentTechnicianId` → `currentTechnicianIds`, kirim `technicianIds`), `complaint-dialog.tsx`, `queue-client.tsx` + `job-detail-client.tsx` (tampilkan semua nama dari `technicians`); Test: `technician-multi-picker.test.tsx` bila web punya runner tes (cek `package.json`); bila tidak, verifikasi manual di Step 4.

**Interfaces — Produces:** `<TechnicianMultiPicker technicians={{id,displayName}[]} value={string[]} onChange={(ids: string[]) => void} excludeJobId?={string} />`. Memuat `useQuery(['technician-jobs','workload'], () => apiClient.get('/technician-jobs/workload'))` sendiri. Daftar centang; teknisi sibuk diberi lencana "Sedang mengerjakan"; mencentang teknisi sibuk membuka dialog konfirmasi (pakai mekanisme konfirmasi yang sudah dipakai `handover.tsx`): "{nama} sedang mengerjakan job {customerName} ({location}). Tetap tugaskan?" dengan tombol Batal / Tetap tugaskan; `onChange` baru dipanggil setelah konfirmasi. Maksimal 5 (centang ke-6 dinonaktifkan).

- [ ] **Step 1:** Tulis tes komponen (bila runner ada): sibuk → dialog muncul dan `onChange` belum terpanggil; "Batal" → tidak berubah; "Tetap tugaskan" → `onChange([...,'t2'])`; teknisi tidak sibuk → langsung `onChange`; centang ke-6 nonaktif. Jalankan → FAIL.
- [ ] **Step 2:** Implementasi komponen; ganti pemakaian `Select` tunggal di tiga berkas dengan komponen ini; `handover.tsx`: pesan konfirmasi alih tugas lama dipertahankan hanya bila job `sedang_dikerjakan` dan set baru tidak beririsan dengan set lama (sama dengan aturan backend), selain itu tombol langsung "Simpan penugasan".
- [ ] **Step 3:** `npm run lint` dan `npx tsc --noEmit` di `epos-frontend-web` → bersih; tes (bila ada) → PASS.
- [ ] **Step 4: Verifikasi manual** (`npm run dev` + backend lokal): pilih 2 teknisi di Terima Servis → kedua job tersimpan; pilih teknisi yang sedang `sedang_dikerjakan` → dialog muncul. **Commit** `feat(web): pilih banyak teknisi + peringatan sibuk`.

### Task 8: Mobile — model, guard UI, pilih banyak teknisi, POS

**Files:** lihat daftar "Modify (mobile)" di atas; Test: `test/` baru `technician_job_assignees_test.dart` dan `technician_multi_picker_test.dart`.

**Interfaces — Consumes:** respons backend `technicianIds`/`technicians`, endpoint `GET /technician-jobs/workload`. **Produces:** `TechnicianJob.technicianIds: List<String>` dan `technicianNames: List<String>` (fallback `[technicianId]` bila respons lama); `technicianWorkloadProvider` (FutureProvider.autoDispose<Map<String, List<BusyJob>>>) di `job_providers.dart`; `TechnicianMultiPicker({required List<String> value, required ValueChanged<List<String>> onChanged, bool enabled = true})` (ConsumerWidget, memakai `techniciansProvider`).

- [ ] **Step 1: Tes gagal dulu:** (a) parse JSON dengan `technicianIds:['a','b']` → kedua id ada; JSON lama tanpa `technicianIds` tapi `technicianId:'a'` → `['a']`; (b) `job_requests_section`: teknisi `b` (bukan `technicianId` pertama tetapi ada di `technicianIds`) → `canSubmit` dan `canUse` true; (c) widget picker: memilih teknisi sibuk menampilkan dialog "sedang mengerjakan" dan `onChanged` belum terpanggil; "Batal" → tidak berubah; "Tetap tugaskan" → `onChanged` terpanggil; pilihan ke-6 ditolak.
- [ ] **Step 2:** `flutter test` pada berkas baru → FAIL.
- [ ] **Step 3: Implementasi.** Model + `_jobFromNest` (`job_repository.dart` ~95: tambah `'technician_ids'`, `'technician_names'`); ganti semua `job.technicianId == user?.uid` (`job_requests_section.dart` ~39, ~45, dan hasil `grep -rn "technicianId ==" lib/`) dengan `job.technicianIds.contains(user?.uid)`; `service_order_create_screen.dart` (`_technicianId` → `_technicianIds`, kirim `technicianIds`), `job_detail_screen.dart` alih tugas (~1400-1470, kirim `technicianIds`; `job_providers.dart` ~326: baca `payload['technicianIds']` dan tetap terima `payload['technicianId']` untuk antrean offline lama), POS `cart_state.dart`/`pos_providers.dart`/`checkout_screen.dart` (`technicianId` → `technicianIds`, `inst['technicianIds']` di ~221 dan ~233, `clearTechnicianId` → `clearTechnicianIds`).
- [ ] **Step 4:** `flutter analyze` bersih; `flutter test` penuh → PASS (perbarui tes POS/keranjang lama yang memakai `technicianId`).
- [ ] **Step 5: Commit** `feat(mobile): penugasan banyak teknisi`. Rilis APK (naikkan versi, build, unggah) dikerjakan lewat alur "build" terpisah setelah Anda menyetujui hasilnya; backend harus sudah ter-deploy lebih dulu.

---

## Self-review

- Cakupan spec: data (T1), guard+query (T2), pembuatan intake/POS/komplain/tambah-unit (T3), assign+notifikasi+handover (T4), workload (T5), laporan (T6), web (T7), mobile + kompatibilitas APK lama (T3/T4/T8), keamanan (validasi T1, peran T5, guard T2), tes per area. Web POS tidak memiliki pemilihan teknisi (hanya `pos/page.tsx` tanpa `technicianId`), sehingga POS hanya diubah di mobile (checkout) dan backend.
- Dialog komplain di mobile tidak ada (tidak ada pemanggil `/complaint` di `frontend/mobile`), jadi komplain hanya diubah di web + backend.
- Konsistensi tipe: `technicianIds: string[]` dan `normalizeTechnicianIds` dipakai sama di semua DTO/service; `addedTechnicianIds`/`previousTechnicianIds` dipakai controller T4.
