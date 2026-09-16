# E-POS AC — Implementation Plan: Siklus 9 — Mode Offline Teknisi (Backend)

**Goal:** Teknisi bisa cache semua data servis hari ini sebelum berangkat (`GET .../today-bundle`), kerja di lapangan tanpa sinyal (checklist, foto, sparepart, catatan, penyelesaian job disimpan lokal di HP oleh Flutter), lalu begitu online kembali, semua aksi offline itu dikirim SEKALI SAJA ke backend lewat satu endpoint batch (`POST .../sync-batch`) yang aman di-retry dan bisa nolak aksi individual yang datanya udah basi tanpa nge-block aksi lain di batch yang sama.

**PENTING — scope:** dokumen ini **backend NestJS saja**. Sisi Flutter (queue lokal pakai sqflite/Hive/Drift, deteksi online/offline, retry logic, UI) di luar scope — cuma disinggung sebagai konteks kenapa endpoint di sini didesain begini (payload gemuk buat precaching, `clientActionId` yang di-generate & disimpan di sisi klien, dll).

**Architecture:** Tidak ada modul baru terpisah — semua ditambahkan ke `src/technician-jobs/` yang sudah ada dari Siklus 1, karena tugas siklus ini murni "membungkus" method-method individual teknisi yang sudah teruji (`toggleChecklistItem`, `addPhoto`, `addMaterialRequest`, `complete`) jadi bisa dipanggil secara batch & idempoten. Satu tabel migration baru (`sync_action_log`) buat dedup.

**Tech Stack:** NestJS + TypeScript, Prisma + PostgreSQL, `class-validator`/`class-transformer`, `RolesGuard` + `@Roles('teknisi')` dari Siklus 1.

---

## Ruang lingkup siklus ini

**Termasuk:**
1. `GET /technician-jobs/queue/today-bundle` — payload gemuk buat precache harian.
2. `POST /technician-jobs/sync-batch` — terima array aksi offline, proses satu-satu, idempoten via `clientActionId`, deteksi konflik via `updatedAt`.
3. Extend endpoint upload foto existing (`POST /technician-jobs/:id/photos`, Task 5.4 Siklus 1) supaya bisa dipakai sebagai "tahap 1" dari alur foto 2-tahap offline (lihat Keputusan Desain #5).
4. Migration `sync_action_log`.

**Sengaja di luar scope:** apa pun di sisi Flutter (local storage, queue, retry scheduler, deteksi konektivitas), dan modifikasi ke method individual teknisi Siklus 1 — method-method itu **dipanggil apa adanya**, bukan diubah.

## Keputusan desain

1. **Batch sync WAJIB idempoten karena rawan dikirim ulang.** Flutter gak selalu tahu apakah `POST /sync-batch` yang barusan dikirim beneran sampai & diproses server atau putus di tengah jalan (timeout, sinyal hilang pas response balik). Satu-satunya perilaku aman di sisi klien adalah **retry seluruh batch** kalau ragu. Kalau server naif memproses ulang aksi yang sama, akibatnya nyata: `toggleChecklistItem` dipanggil 2x untuk toggle yang sama masih relatif aman (idempotent secara alami — `done=true` dua kali tetap `true`), TAPI `addPhoto` dipanggil 2x bikin 2 row `job_photos` buat foto yang sama (dobel di galeri job), dan `addMaterialRequest` dipanggil 2x **paling parah** — motong stok sparepart 2x dan bikin 2 `material_requests` buat pemakaian yang sama (data laporan servis jadi rusak, stok kepotong lebih dari yang sebenarnya dipakai). Makanya setiap action WAJIB bawa `clientActionId` (UUID v4, di-generate SEKALI oleh Flutter saat aksi itu pertama kali dibuat offline, disimpan bareng aksi di local storage, dan **tidak berubah** meski aksi itu di-retry berkali-kali). Server cek dulu ke tabel `sync_action_log` — kalau `clientActionId` itu udah pernah diproses, **skip eksekusi**, langsung balikin hasil yang lama. Baru kalau belum pernah, dieksekusi.
2. **Hanya hasil DETERMINISTIK yang dicatat ke `sync_action_log`** — yaitu `applied` (berhasil) dan `conflict` (job udah berubah di server, gak akan berubah walau di-retry). Hasil `error` yang berasal dari exception TAK TERDUGA (mis. DB sempat down, timeout) **sengaja TIDAK dicatat** — supaya kalau errornya memang transient, retry berikutnya beneran mencoba lagi, bukan langsung ke-skip selamanya karena udah "tercatat" padahal belum pernah sukses. Ini nuansa penting: idempotency guard-nya harus melindungi dari "sukses diproses ulang", bukan malah mengunci aksi yang belum pernah sukses.
3. **Tiap action diproses SATU-SATU dalam loop, bukan 1 `$transaction` besar buat seluruh batch.** Kalau 1 action gagal (misal sparepart-nya keburu habis di server sejak dicache offline), action lain di batch yang sama (misal toggle checklist job lain) tetap harus jalan — jangan sampai 1 kegagalan kecil bikin seluruh sinkronisasi hari itu mental. Ini beda sengaja dari Task 4.4 Siklus 1 (`checkout`) yang sengaja SATU transaction besar karena semua step-nya emang harus atomik jadi 1 invoice.
4. **Deteksi konflik pakai snapshot `updatedAt` per job yang diambil SEKALI di awal batch (baseline), bukan di-refresh tiap action.** Ini poin paling gampang salah kalau gak dipikirkan: kalau dalam satu batch ada 2 action buat job yang sama (misal `checklist_toggle` lalu `notes_update` buat job X, keduanya dibuat offline dengan `clientUpdatedAt` yang sama — snapshot job X waktu di-cache pagi itu), lalu action pertama berhasil diproses dan mengubah `technician_jobs.updated_at` jadi "sekarang", maka kalau action kedua membandingkan `clientUpdatedAt`-nya terhadap `updated_at` server yang **baru saja diubah oleh action pertama itu sendiri**, dia bakal keliatan "basi" padahal itu bukan konflik eksternal sama sekali — cuma efek samping dari urutan pemrosesan batch itu sendiri. Solusinya: sebelum loop mulai, ambil `updatedAt` semua job unik yang disebut di batch (satu query), simpan sebagai `baselineUpdatedAt` per `jobId`, dan pakai baseline itu (bukan nilai live) buat semua perbandingan konflik sepanjang batch itu. Konflik SEHARUSNYA cuma kedeteksi kalau ada perubahan dari LUAR batch ini — misal Admin re-assign job ke teknisi lain lewat web sementara teknisi masih offline di lapangan.
5. **Alur upload foto offline itu 2 TAHAP, bukan 1 request JSON biasa** — karena `SyncActionDto.payload` cuma JSON, gak bisa bawa file biner efisien:
   - **Tahap 1 (saat baru online, di luar `sync-batch`):** Flutter panggil endpoint multipart yang SUDAH ADA dari Siklus 1 (`POST /technician-jobs/:id/photos`, Task 5.4) buat upload byte foto yang tadi tersimpan lokal di HP. Endpoint ini di-extend dikit di siklus ini (bukan diganti) — nerima field opsional `clientActionId` di form-data, dan sebelum manggil `addPhoto`, cek dulu ke `sync_action_log` (dedup yang sama persis dengan sync-batch), jadi upload foto pun aman di-retry kalau koneksi putus pas response baliknya. Endpoint ini balikin `path` server (`/uploads/job-photos/xxxx.jpg`).
   - **Tahap 2 (lewat `sync-batch`):** action bertipe `photo_upload_ref` dikirim dengan payload `{ path, kind }` di mana `path` itu HASIL dari tahap 1 (bukan path lokal HP lagi). Prosesnya di sync-batch **tidak memanggil `addPhoto` lagi** (karena row `job_photos` udah dibuat di tahap 1) — cukup verifikasi row itu ada & tersambung ke job ini. Tujuannya biar Flutter punya alur queue yang SERAGAM (semua jenis aksi, termasuk foto, tetap "dianggap selesai sync" lewat response `sync-batch`), tapi efek berat (nulis DB, potong bandwidth buat file) udah kejadian duluan di tahap 1 yang sifatnya sinkron & langsung dapat konfirmasi sukses/gagal.
6. **Ownership check tetap dipakai** — tiap action divalidasi `job.technicianId === technicianId dari JWT`, sama persis prinsip di Task 5.3 Siklus 1 (teknisi cuma boleh utak-atik job miliknya).
7. **Sparepart yang paling sering dipakai di-precache** (bukan di-query real-time dari `GET /spareparts/search` saat offline, karena itu gak mungkin diakses tanpa sinyal) — jadi `today-bundle` sertakan Top 20 sparepart terlaris 30 hari terakhir, biar Flutter bisa bikin autocomplete lokal.
8. **Tidak ada perubahan pada Prisma model/tabel Siklus 1** kecuali migration baru `sync_action_log` — semua tabel & kolom yang dipakai (`technician_jobs.updated_at`, `job_photos`, `technician_job_checklist_items`, `material_requests`) sudah persis seperti yang dikonfirmasi dari dump SQL asli & migration Siklus 1 Task 0.2.

## Peta modul (file baru/modifikasi)

```
src/
  technician-jobs/
    technician-jobs.controller.ts   → MODIFIKASI: tambah 2 route + extend route upload foto
    technician-jobs.service.ts      → MODIFIKASI: tambah todayBundle(), TIDAK ubah method existing
    offline-sync.service.ts         → BARU: processSyncBatch, dedup & conflict logic, MEMANGGIL method di technician-jobs.service.ts
    dto/
      sync-action.dto.ts            → BARU
      sync-batch.dto.ts             → BARU
    technician-jobs.module.ts       → MODIFIKASI: register OfflineSyncService sebagai provider
prisma/
  schema.prisma                     → MODIFIKASI: tambah model SyncActionLog
  migrations/xxxx_offline_sync_log/ → BARU
```

---

## Fase 0 — Migration `sync_action_log`

### Task 0.1: Model & migration

**File:** Modify `prisma/schema.prisma`, lalu `npx prisma migrate dev --name offline_sync_log`

```prisma
model SyncActionLog {
  id             String   @id @default(cuid())
  clientActionId String   @unique @map("client_action_id")
  jobId          String   @map("job_id")
  actionType     String   @map("action_type")
  processedAt    DateTime @default(now()) @map("processed_at")
  result         Json

  @@map("sync_action_log")
}
```

Migration SQL yang dihasilkan (`prisma migrate dev` bikin file ini otomatis, ditulis di sini biar jelas apa isinya):

```sql
CREATE TABLE "sync_action_log" (
    "id" TEXT NOT NULL,
    "client_action_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,

    CONSTRAINT "sync_action_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_action_log_client_action_id_key" ON "sync_action_log"("client_action_id");
CREATE INDEX "sync_action_log_job_id_idx" ON "sync_action_log"("job_id");
```

Index unik di `client_action_id` itu sendiri sudah cukup buat dedup (`findUnique`/upsert-safe), `job_id` diindex tambahan cuma buat kebutuhan audit ("lihat semua log sync 1 job tertentu"), bukan buat query dedup.

**Verifikasi:** `npx prisma migrate dev` sukses, tabel `sync_action_log` muncul di `prisma studio` dengan kolom persis di atas.

---

## Fase 1 — Endpoint `GET /technician-jobs/queue/today-bundle`

### Task 1.1: `todayBundle()` di service

**File:** Modify `src/technician-jobs/technician-jobs.service.ts`

```typescript
async todayBundle(technicianId: string) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const jobs = await this.prisma.technicianJob.findMany({
    where: {
      technicianId,
      OR: [
        { scheduledDate: { gte: startOfToday, lt: endOfToday } },
        { status: { in: ['assigned', 'in_progress'] } },
      ],
    },
    include: { member: true, unit: true, checklistItems: true },
    orderBy: { scheduledDate: 'asc' },
  });

  const topSpareparts = await this.topUsedSpareparts();

  return { generatedAt: new Date(), jobs, topSpareparts };
}

/** Top 20 sparepart terlaris 30 hari terakhir — buat precache autocomplete offline (Flutter gak bisa hit GET /spareparts/search tanpa sinyal). */
private async topUsedSpareparts() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const grouped = await this.prisma.materialRequestItem.groupBy({
    by: ['refId'],
    where: { kind: 'sparepart', request: { createdAt: { gte: thirtyDaysAgo } } },
    _count: { refId: true },
    orderBy: { _count: { refId: 'desc' } },
    take: 20,
  });
  if (grouped.length === 0) return [];

  const spareparts = await this.prisma.sparepart.findMany({
    where: { id: { in: grouped.map((g) => g.refId!) }, active: true },
  });
  const frequencyById = new Map(grouped.map((g) => [g.refId, g._count.refId]));

  return spareparts
    .map((sp) => ({ ...sp, frequency: frequencyById.get(sp.id) ?? 0 }))
    .sort((a, b) => b.frequency - a.frequency);
}
```

Bundle ini sengaja include `checklistItems` per job (jangan bikin teknisi hit endpoint terpisah per job pas udah di lapangan tanpa sinyal — semua harus udah ada di 1 response ini).

### Task 1.2: Route

**File:** Modify `src/technician-jobs/technician-jobs.controller.ts`

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teknisi')
@Get('queue/today-bundle')
todayBundle(@CurrentUser() user: any) {
  return this.jobsService.todayBundle(user.sub); // technicianId dari JWT, BUKAN dari query param — sama alasan Task 5.2 Siklus 1
}
```

**Verifikasi:**
1. Bikin 2 job buat teknisi A (1 `scheduledDate` hari ini status `menunggu_penugasan`... eh harus `assigned`/`in_progress` biar match; test dengan 1 job `scheduledDate` hari ini + status `selesai`, 1 job `scheduledDate` besok tapi status `in_progress`) → keduanya harus muncul di bundle (masing-masing lolos salah satu kondisi OR), sedangkan job dengan `scheduledDate` kemarin & status `selesai` TIDAK muncul.
2. Tambah 3 `material_request_items` sparepart yang sama dalam 30 hari terakhir → sparepart itu muncul di `topSpareparts` dengan `frequency: 3`, urutan paling atas kalau paling sering.
3. Login sebagai teknisi B (gak punya job) → `jobs: []`, tapi `topSpareparts` tetap ada isinya (data toko-wide, bukan per-teknisi).

---

## Fase 2 — DTO Batch Sync

### Task 2.1: `SyncActionDto` & `SyncBatchDto`

**File:** Create `src/technician-jobs/dto/sync-action.dto.ts`

```typescript
import { ArrayMinSize, IsIn, IsISO8601, IsObject, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SyncActionDto {
  @IsUUID() clientActionId: string;
  @IsIn(['checklist_toggle', 'photo_upload_ref', 'material_add', 'notes_update', 'complete']) type: string;
  @IsString() jobId: string;
  @IsISO8601() clientUpdatedAt: string; // timestamp job.updatedAt di sisi klien SAAT aksi ini dibuat offline (hasil cache dari today-bundle)
  @IsObject() payload: Record<string, unknown>;
}

export class SyncBatchDto {
  @ValidateNested({ each: true })
  @Type(() => SyncActionDto)
  @ArrayMinSize(1)
  actions: SyncActionDto[];
}
```

Bentuk `payload` per `type` (didokumentasikan buat kontrak dengan Flutter, tervalidasi manual di service karena `payload` sengaja generic `Record<string, unknown>` — tiap type punya shape beda):
- `checklist_toggle` → `{ itemId: string; done: boolean }`
- `photo_upload_ref` → `{ path: string; kind: string }` (path = hasil tahap 1, lihat Keputusan Desain #5)
- `material_add` → `{ items: { sparepartId: string; qty: number }[] }`
- `notes_update` → `{ notes: string }`
- `complete` → `{}` (gak butuh payload tambahan)

**Verifikasi:** kirim batch dengan `clientActionId` bukan UUID valid → 400 dari `ValidationPipe` global sebelum masuk service sama sekali (konsisten Task 0.3 Siklus 1).

---

## Fase 3 — `OfflineSyncService` & Endpoint `POST /technician-jobs/sync-batch`

### Task 3.1: `OfflineSyncService.processSyncBatch`

**File:** Create `src/technician-jobs/offline-sync.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TechnicianJobsService } from './technician-jobs.service';
import { SyncActionDto } from './dto/sync-action.dto';

type SyncResult = { clientActionId: string; status: 'applied' | 'skipped_duplicate' | 'conflict' | 'error'; detail: unknown };

@Injectable()
export class OfflineSyncService {
  constructor(private prisma: PrismaService, private jobsService: TechnicianJobsService) {}

  async processSyncBatch(actions: SyncActionDto[], technicianId: string): Promise<SyncResult[]> {
    const jobIds = [...new Set(actions.map((a) => a.jobId))];
    const jobs = await this.prisma.technicianJob.findMany({ where: { id: { in: jobIds } } });
    const jobMap = new Map(jobs.map((j) => [j.id, j]));

    // Snapshot SEKALI di awal — lihat Keputusan Desain #4. JANGAN di-refresh di tengah loop.
    const baselineUpdatedAt = new Map(jobs.map((j) => [j.id, j.updatedAt]));

    const results: SyncResult[] = [];
    for (const action of actions) {
      results.push(await this.processOne(action, technicianId, jobMap, baselineUpdatedAt));
    }
    return results;
  }

  private async processOne(
    action: SyncActionDto,
    technicianId: string,
    jobMap: Map<string, any>,
    baselineUpdatedAt: Map<string, Date>,
  ): Promise<SyncResult> {
    // 1) Dedup — cek dulu SEBELUM eksekusi apa pun, ini yang bikin retry batch aman.
    const already = await this.prisma.syncActionLog.findUnique({ where: { clientActionId: action.clientActionId } });
    if (already) {
      const cached = already.result as { status: SyncResult['status']; detail: unknown };
      return { clientActionId: action.clientActionId, status: 'skipped_duplicate', detail: cached.detail };
    }

    const job = jobMap.get(action.jobId);
    if (!job) return { clientActionId: action.clientActionId, status: 'error', detail: { message: 'Job tidak ditemukan' } };
    if (job.technicianId !== technicianId) {
      return { clientActionId: action.clientActionId, status: 'error', detail: { message: 'Job ini bukan milik teknisi ini' } };
    }

    // 2) Deteksi konflik pakai baseline, BUKAN updatedAt live (lihat Keputusan Desain #4)
    const baseline = baselineUpdatedAt.get(action.jobId)!;
    const clientUpdatedAt = new Date(action.clientUpdatedAt);
    if (clientUpdatedAt < baseline) {
      return this.persistAndReturn(action, 'conflict', {
        message: 'Job berubah di server sejak aksi ini dibuat offline (mis. re-assign teknisi lain)',
        serverUpdatedAt: baseline,
      });
    }

    // 3) Eksekusi — REUSE method existing Siklus 1, satu-satu (bukan 1 transaction besar buat seluruh batch)
    try {
      const detail = await this.dispatch(action, technicianId);
      return this.persistAndReturn(action, 'applied', detail);
    } catch (err: any) {
      // SENGAJA TIDAK di-log ke sync_action_log — kalau errornya transient, retry berikutnya harus beneran nyoba lagi.
      return { clientActionId: action.clientActionId, status: 'error', detail: { message: err.message ?? 'Gagal diproses' } };
    }
  }

  private async dispatch(action: SyncActionDto, technicianId: string): Promise<unknown> {
    switch (action.type) {
      case 'checklist_toggle': {
        const { itemId, done } = action.payload as { itemId: string; done: boolean };
        return this.jobsService.toggleChecklistItem(action.jobId, itemId, done, technicianId);
      }
      case 'photo_upload_ref': {
        // Tahap 2 dari alur foto — path sudah hasil upload tahap 1 (endpoint multipart), TIDAK memanggil addPhoto lagi.
        const { path } = action.payload as { path: string; kind: string };
        const linked = await this.prisma.jobPhoto.findFirst({ where: { jobId: action.jobId, path } });
        if (!linked) throw new Error(`Foto dengan path ${path} belum di-upload lewat endpoint /photos (tahap 1)`);
        return linked;
      }
      case 'material_add': {
        const { items } = action.payload as { items: { sparepartId: string; qty: number }[] };
        return this.jobsService.addMaterialRequest(action.jobId, items, technicianId);
      }
      case 'notes_update': {
        const { notes } = action.payload as { notes: string };
        return this.prisma.technicianJob.update({ where: { id: action.jobId }, data: { notes, updatedAt: new Date() } });
      }
      case 'complete': {
        return this.jobsService.complete(action.jobId, technicianId);
      }
    }
  }

  private async persistAndReturn(action: SyncActionDto, status: 'applied' | 'conflict', detail: unknown): Promise<SyncResult> {
    await this.prisma.syncActionLog.create({
      data: { clientActionId: action.clientActionId, jobId: action.jobId, actionType: action.type, result: { status, detail } },
    });
    return { clientActionId: action.clientActionId, status, detail };
  }
}
```

Catatan penting soal reuse: `toggleChecklistItem`, `addMaterialRequest`, `complete` di atas adalah **method yang PERSIS SAMA** dari `TechnicianJobsService` Task 5.3/5.6/6.1 Siklus 1 — dipanggil langsung via `this.jobsService.xxx(...)`, tidak ada logic checklist/stok/completion yang ditulis ulang di file ini. `notes_update` adalah satu-satunya yang tidak lewat method Siklus 1 (karena Siklus 1 cuma nyebut endpoint `PATCH .../notes` tanpa nulis method service-nya eksplisit), jadi ditulis inline persis pola yang sama (`update` + `updatedAt: new Date()`).

### Task 3.2: Controller

**File:** Modify `src/technician-jobs/technician-jobs.controller.ts`

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teknisi')
@Post('sync-batch')
async syncBatch(@Body() dto: SyncBatchDto, @CurrentUser() user: any) {
  return this.offlineSync.processSyncBatch(dto.actions, user.sub);
}
```

**Verifikasi (WAJIB — 2 test paling penting di siklus ini):**

```typescript
it('kirim batch yang sama 2x gak bikin efek dobel', async () => {
  const clientActionId = 'a1a1a1a1-0000-4000-8000-000000000001';
  const batch = [{ clientActionId, type: 'checklist_toggle', jobId: job.id, clientUpdatedAt: job.updatedAt.toISOString(),
    payload: { itemId: checklistItem.id, done: true } }];

  const first = await offlineSync.processSyncBatch(batch, technicianId);
  expect(first[0].status).toBe('applied');

  const second = await offlineSync.processSyncBatch(batch, technicianId); // simulasi retry krn Flutter ragu apakah tadi sukses
  expect(second[0].status).toBe('skipped_duplicate');

  // buktinya: material_add dobel HARUSNYA motong stok 2x kalau gak idempoten — tes yang lebih ketat pakai type ini
  const materialBatch = [{ clientActionId: 'b2b2b2b2-0000-4000-8000-000000000002', type: 'material_add', jobId: job.id,
    clientUpdatedAt: job.updatedAt.toISOString(), payload: { items: [{ sparepartId: sp.id, qty: 2 }] } }];
  await offlineSync.processSyncBatch(materialBatch, technicianId);
  await offlineSync.processSyncBatch(materialBatch, technicianId); // retry persis sama

  const finalStock = await prisma.sparepart.findUnique({ where: { id: sp.id } });
  expect(finalStock.stock).toBe(initialStock - 2); // BUKAN -4 — kalau dobel diproses, stok kepotong 2x lipat
  const requestCount = await prisma.materialRequest.count({ where: { jobId: job.id } });
  expect(requestCount).toBe(1); // bukan 2
});

it('action dengan clientUpdatedAt basi ditolak status conflict, action lain di batch yang sama tetap diproses', async () => {
  // simulasikan: admin re-assign job ini ke teknisi lain SETELAH teknisi cache today-bundle pagi tadi,
  // jadi updatedAt job di server sekarang lebih baru dari clientUpdatedAt yang dibawa teknisi
  const staleClientUpdatedAt = new Date(job.updatedAt.getTime() - 60_000).toISOString(); // 1 menit sebelum updatedAt asli
  const otherJob = await createAnotherJobFor(technicianId);

  const batch = [
    { clientActionId: 'c3c3c3c3-0000-4000-8000-000000000003', type: 'notes_update', jobId: job.id,
      clientUpdatedAt: staleClientUpdatedAt, payload: { notes: 'harusnya ditolak' } },
    { clientActionId: 'd4d4d4d4-0000-4000-8000-000000000004', type: 'checklist_toggle', jobId: otherJob.id,
      clientUpdatedAt: otherJob.updatedAt.toISOString(), payload: { itemId: otherChecklistItem.id, done: true } },
  ];

  const results = await offlineSync.processSyncBatch(batch, technicianId);

  expect(results[0].status).toBe('conflict');
  expect(results[1].status).toBe('applied'); // action ke-2 di batch yang sama TETAP jalan meski action ke-1 conflict

  const untouchedJob = await prisma.technicianJob.findUnique({ where: { id: job.id } });
  expect(untouchedJob.notes).not.toBe('harusnya ditolak'); // notes gak berubah karena ditolak
});

it('dua action buat job yang sama dalam 1 batch, keduanya clientUpdatedAt sama (baseline), TIDAK saling nge-konflik gara-gara action pertama ubah updatedAt', async () => {
  const snapshot = job.updatedAt.toISOString();
  const batch = [
    { clientActionId: 'e5e5e5e5-0000-4000-8000-000000000005', type: 'checklist_toggle', jobId: job.id,
      clientUpdatedAt: snapshot, payload: { itemId: checklistItem.id, done: true } },
    { clientActionId: 'f6f6f6f6-0000-4000-8000-000000000006', type: 'notes_update', jobId: job.id,
      clientUpdatedAt: snapshot, payload: { notes: 'catatan dari lapangan' } }, // clientUpdatedAt SAMA dgn action di atas
  ];
  const results = await offlineSync.processSyncBatch(batch, technicianId);
  expect(results[0].status).toBe('applied');
  expect(results[1].status).toBe('applied'); // BUKAN conflict, meski action pertama sudah mengubah updatedAt job ini
});
```

---

## Fase 4 — Extend Endpoint Upload Foto (Tahap 1 Alur Offline)

### Task 4.1: Tambah dedup opsional di `POST /technician-jobs/:id/photos`

**File:** Modify `src/technician-jobs/technician-jobs.controller.ts` (route dari Task 5.4 Siklus 1)

```typescript
@Post(':id/photos')
@UseInterceptors(FileInterceptor('photo', { storage: diskStorage({
  destination: './uploads/job-photos',
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
})}))
async uploadPhoto(
  @Param('id') jobId: string,
  @UploadedFile() file: Express.Multer.File,
  @Body('kind') kind: string,
  @Body('clientActionId') clientActionId: string | undefined, // BARU, opsional — dikirim Flutter kalau ini upload hasil foto offline
  @CurrentUser() user: any,
) {
  if (clientActionId) {
    const already = await this.offlineSync.findLoggedAction(clientActionId);
    if (already) return already.detail; // idempoten — retry upload gak bikin row job_photos kedua
  }
  const photo = await this.jobsService.addPhoto(jobId, kind, `/uploads/job-photos/${file.filename}`, user.sub);
  if (clientActionId) await this.offlineSync.persistPhotoUploadLog(clientActionId, jobId, photo);
  return photo;
}
```

**File:** Modify `src/technician-jobs/offline-sync.service.ts` — tambah 2 helper kecil yang dipakai controller di atas:

```typescript
async findLoggedAction(clientActionId: string) {
  const row = await this.prisma.syncActionLog.findUnique({ where: { clientActionId } });
  return row ? (row.result as { status: string; detail: unknown }) : null;
}

async persistPhotoUploadLog(clientActionId: string, jobId: string, photo: unknown) {
  await this.prisma.syncActionLog.create({
    data: { clientActionId, jobId, actionType: 'photo_upload_binary', result: { status: 'applied', detail: photo } },
  });
}
```

Catatan: ini **memperluas** endpoint yang sudah ada dari Siklus 1 (nambah 1 parameter opsional + guard dedup di depan), bukan bikin endpoint upload foto baru — kalau `clientActionId` tidak dikirim (alur online normal, foto langsung diambil & diupload saat ada sinyal), perilakunya persis sama seperti Siklus 1 tanpa perubahan apa pun.

**Verifikasi:**
1. Panggil `POST /technician-jobs/:id/photos` tanpa `clientActionId` (simulasi alur online normal Siklus 1) → tetap jalan seperti biasa, bikin 1 row `job_photos`.
2. Panggil dengan `clientActionId` yang sama 2x (simulasi retry upload pas baru online, sinyal masih goyang) → row `job_photos` cuma 1, response ke-2 identik dengan response ke-1.
3. Lanjutkan dengan `POST /technician-jobs/sync-batch` action `photo_upload_ref` pakai `path` hasil upload di atas → status `applied`, dan **tidak** bikin row `job_photos` kedua (verifikasi lewat `prisma.jobPhoto.count()` tetap 1).

### Task 4.2: Module wiring

**File:** Modify `src/technician-jobs/technician-jobs.module.ts`

```typescript
@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [TechnicianJobsController],
  providers: [TechnicianJobsService, OfflineSyncService],
  exports: [TechnicianJobsService],
})
export class TechnicianJobsModule {}
```

**Verifikasi:** `npm run start:dev` nyala tanpa circular dependency error (`OfflineSyncService` inject `TechnicianJobsService`, satu arah aja, aman).

---

## Skenario tes end-to-end (jalanin manual setelah semua fase kelar)

1. Login teknisi (sudah ada 2 job dari Siklus 1: 1 job pemasangan hari ini status `assigned` dengan 3 checklist item, 1 job status `in_progress` scheduled kemarin).
2. `GET /technician-jobs/queue/today-bundle` → cek response berisi 2 job lengkap dengan `member`, `unit`, `checklistItems`, plus `topSpareparts` (kalau data historis sparepart ada dari Siklus 1).
3. Simulasikan offline: catat `clientActionId` UUID buat tiap aksi berikut, jangan kirim ke server dulu — toggle checklist item 1 (`done:true`), tambah 1 sparepart qty 1, isi catatan "AC bocor freon di pipa outdoor".
4. Simulasikan ambil 1 foto offline (path lokal cuma di "HP").
5. Simulasikan online kembali: panggil `POST /technician-jobs/:id/photos` (tahap 1) dengan `clientActionId` foto tadi → dapat `path` server.
6. Kirim `POST /technician-jobs/sync-batch` berisi 4 action (`checklist_toggle`, `material_add`, `notes_update`, `photo_upload_ref` dengan `path` dari langkah 5) — semua `clientUpdatedAt` = `updatedAt` job dari hasil `today-bundle` di langkah 2.
7. Cek semua 4 hasil status `applied`. Cek DB: checklist item 1 `done=true`, `material_requests`+`material_request_items` kebentuk & stok sparepart berkurang 1x (bukan 2x), `technician_jobs.notes` keisi, `job_photos` ada 1 row baru nyambung ke `path` yang benar.
8. **Retry seluruh batch yang SAMA PERSIS (`clientActionId` sama semua)** dari langkah 6 → semua 4 hasil status `skipped_duplicate`. Cek DB tidak ada perubahan tambahan (stok gak kepotong lagi, checklist tetap 1 row `done_at` yang sama, `job_photos` tetap 1 row).
9. Simulasikan admin re-assign job ini ke teknisi lain (`PATCH /technician-jobs/:id/assign` dari Siklus 1) — ini mengubah `technician_jobs.updated_at`.
10. Kirim 1 action lagi (`clientActionId` baru) buat job yang sama dengan `clientUpdatedAt` yang MASIH nilai lama (dari cache pagi, sebelum langkah 9) → status `conflict`, job tidak berubah oleh action ini.
11. Toggle 2 checklist item terakhir + `complete` lewat batch baru (`clientUpdatedAt` di-refresh ke nilai terbaru dari respons langkah 10, karena teknisi ini sekarang bukan pemilik job lagi — action ini malah harusnya gagal karena ownership check, konfirmasikan pesan error-nya jelas: "Job ini bukan milik teknisi ini").

Kalau langkah 1-11 lolos, siklus mode offline teknisi (backend) beres dan siap diintegrasikan ke sisi Flutter.

---

## Dependency

- **Siklus 1** (`2026-08-20-siklus-penjualan-instalasi-servis.md`) — wajib sudah diimplementasi & lolos skenario e2e-nya duluan. Siklus ini **reuse langsung, tidak reimplementasi**:
  - `TechnicianJobsService.toggleChecklistItem`, `.addPhoto`, `.addMaterialRequest`, `.complete` (Task 5.3, 5.4, 5.6, 6.1) — dipanggil apa adanya dari `OfflineSyncService.dispatch()`.
  - Struktur tabel `technician_jobs` (termasuk kolom `updated_at NOT NULL` — dikonfirmasi dari SQL dump asli, krusial buat conflict check di Task 3.1) dan `technician_job_checklist_items` (migration Siklus 1 Task 0.2).
  - Tabel `job_photos` (kolom `id, job_id, kind, path, uploaded_by, created_at` — dikonfirmasi dari dump asli, dipakai di Task 3.1 & 4.1 buat cek `jobPhoto.findFirst({ path })`).
  - `RolesGuard` + `@Roles('teknisi')` + `JwtAuthGuard` + `CurrentUser` decorator dari `src/auth/`.
  - `PrismaService` dari `src/prisma/`.
  - `StockLockingService` — dipakai TRANSITIF lewat `addMaterialRequest` (tidak dipanggil langsung dari siklus ini), jadi proteksi race condition stok tetap berlaku otomatis meski sparepart dipilih lewat sync-batch.
- **Siklus 2** (`2026-08-20-siklus-servis-masuk-mandiri.md`) — kalau sudah ada, endpoint `today-bundle` otomatis ikut nyakup job dari jalur servis mandiri juga (karena query-nya cuma filter `technicianId` + `status`/`scheduledDate`, gak peduli job itu lahir dari `pos/checkout` atau `service-orders/intake`). Tidak ada modifikasi tambahan dibutuhkan di sini kalau Siklus 2 sudah jalan duluan.
- Tidak ada dependency ke Siklus 3-8 — modul ini murni pembungkus di atas engine `technician-jobs` Siklus 1.
