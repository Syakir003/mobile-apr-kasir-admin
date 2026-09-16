# E-POS AC — Implementation Plan: Siklus 7 — Reminder Servis via WhatsApp (Worker Beneran Kirim)

**Goal:** Bikin cron harian yang nyari customer yang unit AC-nya udah jatuh tempo servis (`member_ac_units.next_service_date`), lalu beneran ngirim pesan WhatsApp lewat provider pihak ketiga — pakai BullMQ queue biar gak nembak rate limit provider — dan nyatet status kirimnya balik ke `whatsapp_logs`.

**Ini BUKAN pengganti** `NotificationsService.logServiceCompleted()` dari Siklus 1 (yang cuma insert row `whatsapp_logs` status `pending` pas job servis selesai). Plan ini **nambahin** konsumen baru: cron scanner yang cari unit jatuh tempo (independen dari trigger "job selesai"), plus worker yang beneran proses row `pending` — baik yang dari `logServiceCompleted()` maupun dari cron reminder di sini — jadi `terkirim`/`gagal`.

**Tech Stack tambahan siklus ini:** `@nestjs/bullmq` + `bullmq` (queue, butuh Redis sebagai backend), `@nestjs/schedule` (cron), Redis instance.

---

## Ruang lingkup siklus ini

**Termasuk:** setup BullMQ + koneksi Redis, interface abstraksi `WhatsappProvider` + implementasi Fonnte, cron harian pemindai unit jatuh tempo servis, queue processor pengirim pesan dengan rate limit, endpoint manual trigger buat testing.

**Sengaja di luar scope:** UI admin buat atur template pesan (hardcode 1 template dulu, cukup buat skala 1 toko), broadcast promo/campaign non-servis (itu ranah Siklus 6 voucher, beda kanal), retry policy custom di luar bawaan BullMQ.

### ⚠️ Prasyarat WAJIB dibereskan sebelum mulai coding fase ini

1. **Redis harus jalan di VPS.** Ini dependency infrastruktur baru yang **belum pernah disebut** di plan-plan siklus sebelumnya (Siklus 1 gak butuh Redis sama sekali). BullMQ *tidak bisa jalan tanpa Redis* — ini bukan opsional, bukan bisa "nanti aja". Sebelum Task 1.1 dikerjain:
   - Kalau infra pakai Docker Compose, tambahin service ini ke `docker-compose.yml`:
     ```yaml
     redis:
       image: redis:7-alpine
       restart: unless-stopped
       ports:
         - "6379:6379"
       volumes:
         - redis-data:/data
     ```
   - Kalau bare-metal VPS: `sudo apt install redis-server` lalu pastikan `systemctl enable --now redis-server`.
   - Tes manual: `redis-cli ping` harus balikin `PONG` sebelum lanjut ke task berikutnya.
   - Tambahin `REDIS_HOST` dan `REDIS_PORT` ke `.env` (lihat Task 1.1).

2. **Provider WhatsApp (Fonnte) BELUM FINAL dipilih tim.** Karena itu, desain di plan ini **wajib** pakai interface abstraksi `WhatsappProvider` (Task 2.1) — implementasi Fonnte cuma satu dari kemungkinan implementasi, bukan hardcode API call di business logic (cron/processor). Kalau nanti tim pindah ke provider lain (WABA resmi Meta, Woowa, dll), yang diubah cuma bikin class baru implement interface yang sama + ganti 1 baris binding di module — **bukan** ubah `reminder.cron.ts` atau `reminder.processor.ts`. Endpoint & format request Fonnte yang ditulis di Task 2.2 adalah **placeholder berdasarkan dokumentasi publik Fonnte** — WAJIB diverifikasi ulang begitu API key beneran didapat dari tim, karena field response (`status`, `detail`, dll) belum pernah dicek langsung.

## Keputusan desain

1. **Provider abstraction via custom injection token** (`@Inject('WHATSAPP_PROVIDER')`) — bukan cuma interface TypeScript kosong yang diimplementasi tapi tetap di-hardcode importnya di service. Consumer (`ReminderProcessor`) cuma tau ada `WhatsappProvider`, gak tau itu Fonnte apa yang lain. Ganti provider = ganti binding di `notifications.module.ts`, titik.
2. **Redis sebagai infra baru dicatat eksplisit** (bukan diasumsikan sudah ada) — poin ini yang paling gampang kelewat kalau plan ini ditulis kayak nyambung biasa dari siklus-siklus lain yang semuanya cuma butuh Postgres.
3. **Dedup reminder pakai window 24 jam berbasis `whatsapp_logs` terakhir per unit**, bukan flag boolean baru di `member_ac_units`. Alasan: `whatsapp_logs` udah punya `unit_id` + `created_at`, jadi query `findFirst` langsung cukup — gak perlu migration kolom baru, dan otomatis "self-healing": kalau reminder kemarin gagal terus gak ke-retry (worker down misalnya), 24 jam kemudian cron bakal coba enqueue ulang secara alami.
4. **Retry pakai mekanisme bawaan BullMQ** (`attempts: 3` + backoff), bukan custom retry loop manual — BullMQ udah handle exponential backoff & dead job tracking, gak perlu reinvent.
5. **Rate limiting pakai `limiter` option bawaan `@Processor`** (declarative, per-queue), bukan `setTimeout`/sleep manual di business logic — lebih robust karena BullMQ yang jaga rate-nya di level scheduling job, bukan di kode consumer.
6. **Endpoint manual trigger** (`POST /notifications/reminders/run-now`, admin only) — kebutuhan praktis pas development: gak masuk akal nunggu jam 8 pagi tiap kali mau tes ulang alur ini.
7. **Skala 1 toko** → gak perlu multi-tenant queue config, gak perlu horizontal scaling worker, satu proses Nest app aja yang jalanin baik API maupun BullMQ worker (`@Processor` otomatis jalan di proses yang sama kalau gak dipisah eksplisit) — cukup buat volume 1 toko servis AC.

## Peta modul (tambahan ke struktur `src/` Siklus 1)

```
src/
  queue/
    queue.module.ts          → registrasi koneksi Redis BullMQ (global, dipakai NotificationsModule)
  notifications/
    notifications.module.ts  → (modify) wire queue + provider + cron + processor
    notifications.controller.ts → (modify) tambah POST /notifications/reminders/run-now
    notifications.service.ts → (sudah ada dari Siklus 1, logServiceCompleted() gak berubah)
    reminder.cron.ts         → pemindai harian, enqueue job
    reminder.processor.ts    → consumer queue, panggil provider, update status
    providers/
      whatsapp-provider.interface.ts → kontrak abstraksi
      fonnte.provider.ts            → implementasi konkret Fonnte
test/
  fakes/
    fake-whatsapp.provider.ts → dipasang di testing module, gak beneran hit API luar
```

---

## Fase 1 — Setup BullMQ & Koneksi Redis

### Task 1.1: Install dependency & QueueModule

**File:**
- Modify: `.env` — tambah `REDIS_HOST=localhost`, `REDIS_PORT=6379`, `FONNTE_API_KEY=`, `WHATSAPP_PROVIDER_DRIVER=fonnte`
- Create: `src/queue/queue.module.ts`

```bash
npm install @nestjs/bullmq bullmq @nestjs/schedule
```

```typescript
// src/queue/queue.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

Modify `src/app.module.ts` — import `QueueModule` dan `ScheduleModule.forRoot()` (dari `@nestjs/schedule`, dibutuhin biar decorator `@Cron()` di Task 3.1 kedetect) di level root, sekali aja:

```typescript
// src/app.module.ts (potongan relevan)
import { ScheduleModule } from '@nestjs/schedule';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    // ...module lain dari Siklus 1
    ScheduleModule.forRoot(),
    QueueModule,
    NotificationsModule,
  ],
})
export class AppModule {}
```

**Verifikasi:** `redis-cli ping` balikin `PONG` di VPS. `npm run start:dev` nyala tanpa error koneksi Redis di log (kalau Redis mati, Nest bakal keliatan retry-connect terus di log — itu tandanya prasyarat #1 belum beres).

---

## Fase 2 — Abstraksi Provider WhatsApp

### Task 2.1: Interface kontrak

**File:** Create: `src/notifications/providers/whatsapp-provider.interface.ts`

```typescript
export interface WhatsappProvider {
  send(phone: string, message: string): Promise<{ success: boolean; raw: unknown }>;
}
```

**Verifikasi:** file ini gak import apapun dari luar (`@nestjs/*`, `fetch`, dll) — murni kontrak, biar bener-bener gak ke-couple ke provider manapun.

### Task 2.2: Implementasi Fonnte (konkret, tapi bisa diganti)

**File:** Create: `src/notifications/providers/fonnte.provider.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappProvider } from './whatsapp-provider.interface';

@Injectable()
export class FonnteProvider implements WhatsappProvider {
  constructor(private config: ConfigService) {}

  async send(phone: string, message: string): Promise<{ success: boolean; raw: unknown }> {
    const apiKey = this.config.get<string>('FONNTE_API_KEY');

    // CATATAN: endpoint & shape response ini berdasar dokumentasi publik Fonnte,
    // BELUM diverifikasi pakai API key asli tim (provider belum final dipilih).
    // Cek ulang field 'status' di response begitu API key beneran ada.
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        Authorization: apiKey ?? '',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ target: phone, message }),
    });

    const raw = await res.json();
    const success = res.ok && raw?.status !== false;
    return { success, raw };
  }
}
```

**Verifikasi:** unit test dengan `fetch` di-mock (`jest.spyOn(global, 'fetch')`), pastikan `send()` balikin `success: true` kalau mock response `{ status: true }`, dan `success: false` kalau `{ status: false }`.

### Task 2.3: Binding token custom di module

**File:** Create/Modify: `src/notifications/notifications.module.ts`

```typescript
// src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ReminderCron } from './reminder.cron';
import { ReminderProcessor } from './reminder.processor';
import { FonnteProvider } from './providers/fonnte.provider';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'reminder-queue' }),
    PrismaModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    ReminderCron,
    ReminderProcessor,
    FonnteProvider,
    {
      // Satu-satunya baris yang perlu diubah kalau tim ganti provider WA nanti:
      // ganti `useExisting: FonnteProvider` jadi provider lain yang implement WhatsappProvider.
      provide: 'WHATSAPP_PROVIDER',
      useExisting: FonnteProvider,
    },
  ],
  exports: [NotificationsService, ReminderCron],
})
export class NotificationsModule {}
```

**Verifikasi:** `npm run start:dev` nyala tanpa `UnknownDependenciesException` soal `WHATSAPP_PROVIDER` — tandanya DI binding-nya kekonek bener ke `ReminderProcessor` (Task 4.1).

---

## Fase 3 — Cron Scanner

### Task 3.1: Pemindai unit jatuh tempo servis

**File:** Create: `src/notifications/reminder.cron.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReminderCron {
  private readonly logger = new Logger(ReminderCron.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('reminder-queue') private queue: Queue,
  ) {}

  @Cron('0 8 * * *') // tiap hari jam 8 pagi
  async checkAndEnqueue() {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Hanya unit yang udah terpasang (bukan yang masih 'menunggu_pemasangan') dan udah jatuh tempo.
    const dueUnits = await this.prisma.memberAcUnit.findMany({
      where: { status: 'terpasang', nextServiceDate: { lte: todayEnd } },
      include: { member: true },
    });

    let enqueued = 0;
    for (const unit of dueUnits) {
      if (!unit.member?.phone) continue; // gak ada nomor HP tercatat, gak ada tujuan kirim

      // Dedup: skip kalau unit ini udah punya whatsapp_logs (apapun statusnya) dalam 24 jam terakhir,
      // biar gak spam reminder ganda tiap hari selama belum sempat diproses/ke-retry worker.
      const recentLog = await this.prisma.whatsappLog.findFirst({
        where: { unitId: unit.id, createdAt: { gte: oneDayAgo } },
      });
      if (recentLog) continue;

      const message = `Halo ${unit.member.name}, AC ${unit.brand ?? ''} ${unit.model ?? ''} Anda sudah waktunya diservis rutin. Hubungi kami untuk jadwalkan kunjungan teknisi ya!`;

      const log = await this.prisma.whatsappLog.create({
        data: {
          memberId: unit.memberId,
          unitId: unit.id,
          phone: unit.member.phone,
          message,
          status: 'pending',
        },
      });

      await this.queue.add(
        'send-reminder',
        { whatsappLogId: log.id },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
      enqueued++;
    }

    this.logger.log(`Reminder scan selesai: ${enqueued} job di-enqueue dari ${dueUnits.length} unit jatuh tempo`);
    return { scanned: dueUnits.length, enqueued };
  }
}
```

**Verifikasi:** seed 1 `member_ac_unit` dengan `status='terpasang'` & `next_service_date` = kemarin, panggil `checkAndEnqueue()` langsung dari unit test (bukan nunggu cron) — cek row baru muncul di `whatsapp_logs` status `pending`, dan `queue.add` ke-panggil sekali (mock `Queue`).

---

## Fase 4 — Processor & Rate Limiting

### Task 4.1: Consumer queue

**File:** Create: `src/notifications/reminder.processor.ts`

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappProvider } from './providers/whatsapp-provider.interface';

@Processor('reminder-queue', { limiter: { max: 10, duration: 60000 } })
// max 10 pesan/menit — ANGKA PLACEHOLDER, WAJIB disesuaikan ke limit resmi
// akun/API key Fonnte begitu kontraknya final (bisa lebih rendah/tinggi dari ini).
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    private prisma: PrismaService,
    @Inject('WHATSAPP_PROVIDER') private whatsapp: WhatsappProvider,
  ) {
    super();
  }

  async process(job: Job<{ whatsappLogId: string }>) {
    const log = await this.prisma.whatsappLog.findUnique({ where: { id: job.data.whatsappLogId } });
    if (!log) return; // row kehapus manual, gak perlu diproses/di-retry lagi

    try {
      const result = await this.whatsapp.send(log.phone, log.message);
      if (!result.success) throw new Error('Provider WA balikin status gagal');

      await this.prisma.whatsappLog.update({
        where: { id: log.id },
        data: { status: 'terkirim', providerResponse: result.raw as any, sentAt: new Date() },
      });
    } catch (err) {
      await this.prisma.whatsappLog.update({
        where: { id: log.id },
        data: { status: 'gagal', providerResponse: { error: (err as Error).message } as any },
      });
      // Lempar ulang: BullMQ hitung ini sebagai 1 attempt gagal, otomatis retry
      // sesuai `attempts: 3` yang di-set di reminder.cron.ts. Kalau retry berikutnya
      // sukses, status di atas otomatis ke-overwrite jadi 'terkirim'.
      throw err;
    }
  }
}
```

**Verifikasi:**
1. Unit test dengan `WHATSAPP_PROVIDER` mock yang `send()` resolve `{ success: true, raw: {...} }` → cek `whatsappLog.update` dipanggil dengan `status: 'terkirim'`.
2. Unit test dengan mock yang throw / balikin `success: false` → cek `status: 'gagal'` ke-set DAN exception ke-lempar ulang (test pakai `expect(...).rejects.toThrow()`).

---

## Fase 5 — Endpoint Manual Trigger (Testing/Development)

### Task 5.1: `POST /notifications/reminders/run-now`

**File:** Modify: `src/notifications/notifications.controller.ts`

```typescript
// src/notifications/notifications.controller.ts (tambahan route)
import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReminderCron } from './reminder.cron';

@Controller('notifications')
export class NotificationsController {
  constructor(private reminderCron: ReminderCron /*, ...dependency lain dari Siklus 1 */) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('reminders/run-now')
  async runNow() {
    return this.reminderCron.checkAndEnqueue();
  }
}
```

Kenapa admin-only: ini trigger manual yang langsung nyiptain row `whatsapp_logs` baru + push job kirim WA beneran (di luar env test) — bukan endpoint yang aman dipencet kasir/teknisi coba-coba pas jam kerja.

**Verifikasi:** login sebagai kasir/teknisi → hit endpoint ini → 403. Login admin → hit endpoint ini → 200, response `{ scanned, enqueued }`, cocok sama jumlah unit yang di-seed jatuh tempo.

---

## Skenario tes end-to-end

**Prinsip penting: JANGAN pakai `FonnteProvider` asli pas development/testing** — pasang `FakeWhatsappProvider` biar gak beneran ngirim WA ke nomor asli tiap kali coba alur ini.

```typescript
// test/fakes/fake-whatsapp.provider.ts
import { Injectable } from '@nestjs/common';
import { WhatsappProvider } from '../../src/notifications/providers/whatsapp-provider.interface';

@Injectable()
export class FakeWhatsappProvider implements WhatsappProvider {
  public sentMessages: { phone: string; message: string }[] = [];

  async send(phone: string, message: string) {
    this.sentMessages.push({ phone, message });
    return { success: true, raw: { fake: true, phone, message } };
  }
}
```

Pasang di testing module (override binding token yang sama, gak perlu ubah kode module produksi sama sekali — ini bukti nyata gunanya abstraksi Task 2.1):

```typescript
// test/reminder.e2e-spec.ts (potongan setup)
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { FakeWhatsappProvider } from './fakes/fake-whatsapp.provider';

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider('WHATSAPP_PROVIDER')
  .useClass(FakeWhatsappProvider)
  .compile();
const app = moduleRef.createNestApplication();
await app.init();
```

Langkah manual/e2e:
1. Pastikan Redis nyala (`redis-cli ping` → `PONG`) dan `.env` terisi `REDIS_HOST`/`REDIS_PORT`.
2. Seed 1 `member` (dengan `phone` terisi) + 1 `member_ac_units` dengan `status='terpasang'` dan `next_service_date` = kemarin.
3. Jalankan app dengan `FakeWhatsappProvider` ter-override (bukan `FonnteProvider` asli).
4. Login admin → `POST /notifications/reminders/run-now`.
5. Cek response: `{ scanned: 1, enqueued: 1 }`.
6. Tunggu sebentar (worker BullMQ proses job async, biasanya < 1 detik di test) → cek row `whatsapp_logs` yang baru: `status` berubah dari `pending` jadi `terkirim`, `provider_response` isinya `{ fake: true, ... }`, `sent_at` terisi.
7. Panggil `POST /notifications/reminders/run-now` **lagi tanpa ubah data apapun** → response harus `{ scanned: 1, enqueued: 0 }` — ini bukti logic dedup 24 jam (Task 3.1) jalan, gak dobel-kirim.
8. Skenario gagal: buat varian fake provider yang `send()`-nya `throw new Error('simulasi gagal')` atau balikin `{ success: false, raw: {...} }`, ulangi langkah 2-6 → cek `whatsapp_logs.status` jadi `gagal`, `provider_response` ada field `error`, dan (kalau mock `fetch`/provider dihitung jumlah panggilannya) provider ke-panggil sampai 3 kali sesuai `attempts: 3` sebelum job dianggap failed permanen oleh BullMQ.
9. (Opsional, sekali aja pas mau deploy) matikan override provider, isi `FONNTE_API_KEY` asli, tes manual ke 1 nomor HP sendiri buat pastiin format request Task 2.2 beneran nyambung ke akun Fonnte yang final dipilih tim.

---

## Dependency

- **Siklus 1** (`2026-08-20-siklus-penjualan-instalasi-servis.md`) — tabel `whatsapp_logs` dan `member_ac_units.next_service_date` harus udah ada & keisi lewat alur checkout+servis yang jalan (Fase 6 Task 6.1 yang nge-set `next_service_date` pas job servis selesai). Siklus ini murni nambah consumer baru, gak ubah `NotificationsService.logServiceCompleted()`.
- **Infra Redis** — WAJIB tersedia & running di VPS sebelum Fase 1 dimulai (lihat "Prasyarat" di atas). Ini dependency infrastruktur baru, bukan cuma dependency npm.
- **Keputusan bisnis provider WA** — Fase 2 (implementasi Fonnte) bisa mulai duluan sebagai placeholder/dugaan terbaik dari dokumentasi publik, tapi **wajib direview ulang** begitu tim final milih provider & dapet API key asli — jangan anggap Task 2.2 selesai permanen sebelum itu.
- Paket npm baru: `@nestjs/bullmq`, `bullmq`, `@nestjs/schedule` (belum dipakai sama sekali di Siklus 1-6).
