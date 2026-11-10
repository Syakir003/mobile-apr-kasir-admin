# Harga di Depan, Cara Tagih, dan Void Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin bisa memberi harga perkiraan jasa saat Terima Servis, order punya penanda cara tagih (`bayar_di_lokasi` / `ditagih_admin`), dan invoice servis otomatis berstatus `batal` ketika job terakhir di order dibatalkan.

**Architecture:** Kolom baru `service_orders.payment_mode` (bawaan `ditagih_admin` supaya order lama, pemasangan POS, dan app Flutter tidak berubah). Isi `ServicePricingService.set` dipisah menjadi `setWithin(tx, …)` supaya Terima Servis bisa membuat order, job, dan harga awal dalam satu transaksi. Pembatalan invoice ditaruh di util kecil `invoice-void.util.ts` yang dipanggil dari `TechnicianJobsService.cancel`; laporan penjualan mengecualikan invoice `batal`.

**Tech Stack:** NestJS 11, Prisma 7 (migrasi SQL manual + `prisma generate`), class-validator, Jest 30 dengan prisma/tx tiruan.

Spesifikasi: `epos-backend/docs/superpowers/specs/2026-11-07-pembayaran-lapangan-teknisi-design.md`. Peta: `2026-11-10-pembayaran-lapangan-00-peta.md`.

**Catatan kerja:**
- Perintah dijalankan dari `Nest/epos-backend` kecuali disebut lain. File CRLF: pakai alat Edit; bila penggantian multi-baris gagal karena CRLF, pakai skrip Node kecil dengan `.replace` pada string yang sudah diubah `\n` → `\r\n`.
- Commit **tanpa** baris `Co-Authored-By`. Jangan push.
- Tes yang ada di repo memakai `jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }))` bila file yang diimpor menyeret modul reminders (ESM). Salin baris itu ke spec baru yang mengimpor service.

---

## File Structure

| File | Aksi | Tanggung jawab |
|---|---|---|
| `prisma/schema.prisma` | Ubah | Kolom `ServiceOrder.paymentMode` |
| `prisma/migrations/20261110000000_order_payment_mode/migration.sql` | Buat | `ALTER TABLE` kolom baru |
| `src/service-orders/payment-mode.ts` | Buat | Konstanta + tipe `PaymentMode` |
| `src/service-orders/dto/service-intake.dto.ts` | Ubah | `paymentMode`, `serviceLines`, `transportLevel`, `transportMode` |
| `src/service-orders/dto/update-service-order.dto.ts` | Ubah | `paymentMode` |
| `src/service-orders/service-orders.service.ts` | Ubah | Simpan cara tagih, panggil harga awal, ubah cara tagih di `update` |
| `src/technician-jobs/service-pricing.service.ts` | Ubah | Pisahkan `setWithin(tx, …)` dari `set` |
| `src/technician-jobs/technician-jobs.module.ts` | Ubah | Export `ServicePricingService` |
| `src/technician-jobs/invoice-void.util.ts` | Buat | `assertLastJobCancelAllowed`, `voidInvoiceIfOrderCancelled` |
| `src/technician-jobs/technician-jobs.service.ts` | Ubah | Panggil util di `cancel()` |
| `src/invoices/invoices.service.ts` | Ubah | Invoice `batal` tidak bisa dikirim WA |
| `src/reports/reports.service.ts` | Ubah | `sales()` mengecualikan `batal` |
| Spec: `service-orders.intake.spec.ts`, `service-orders.update.spec.ts` (ubah), `invoice-void.util.spec.ts`, `technician-jobs.multi-unit.spec.ts` (ubah), `invoices.void.spec.ts`, `reports.service.sales-batal.spec.ts` (buat) | | |
| `CLAUDE.md` (root `Nest/`) | Ubah | Catat fitur (file tidak ikut git) |

---

### Task 1: Kolom `payment_mode` (schema + migrasi)

**Files:**
- Modify: `prisma/schema.prisma` (model `ServiceOrder`, setelah `technicianNote`)
- Create: `prisma/migrations/20261110000000_order_payment_mode/migration.sql`
- Create: `src/service-orders/payment-mode.ts`

- [ ] **Step 1: Tambah kolom di schema**

Di model `ServiceOrder`, tepat setelah baris `technicianNote String? @map("technician_note")`, sisipkan:

```prisma
  // Cara tagih order servis: 'bayar_di_lokasi' (teknisi menagih di lokasi) atau 'ditagih_admin' (instansi/langganan, admin
  // menagih belakangan). Bawaan 'ditagih_admin' = perilaku sebelum fitur pembayaran lapangan, jadi order lama, pemasangan
  // POS, dan order dari app Flutter tidak berubah. Terima Servis web mengisi 'bayar_di_lokasi' kecuali dipilih lain.
  paymentMode String @default("ditagih_admin") @map("payment_mode")
```

- [ ] **Step 2: Tulis migrasi**

Buat `prisma/migrations/20261110000000_order_payment_mode/migration.sql`:

```sql
-- Cara tagih order servis (spesifikasi pembayaran lapangan). Order yang sudah ada tetap 'ditagih_admin'.
ALTER TABLE "service_orders" ADD COLUMN "payment_mode" TEXT NOT NULL DEFAULT 'ditagih_admin';
```

- [ ] **Step 3: Konstanta tipe**

Buat `src/service-orders/payment-mode.ts`:

```ts
// Cara tagih order servis. 'bayar_di_lokasi': teknisi menagih di lokasi dan mencatat pembayaran. 'ditagih_admin':
// pelanggan ditagih admin belakangan (instansi/langganan) — perilaku sebelum fitur pembayaran lapangan.
export const PAYMENT_MODES = ['bayar_di_lokasi', 'ditagih_admin'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
```

- [ ] **Step 4: Terapkan dan generate**

Run: `npx prisma validate && npx prisma migrate deploy && npx prisma generate`
Expected: `The schema ... is valid`, migrasi `20261110000000_order_payment_mode` terpasang, `Generated Prisma Client`. (Backend dev perlu dimatikan bila Windows mengunci DLL Prisma.)

- [ ] **Step 5: Typecheck dan commit**

Run: `npx tsc --noEmit`
Expected: tidak ada keluaran.

```bash
git add prisma/schema.prisma prisma/migrations/20261110000000_order_payment_mode src/service-orders/payment-mode.ts
git commit -m "feat(servis): kolom cara tagih order (payment_mode), bawaan ditagih_admin"
```

---

### Task 2: Cara tagih di DTO, intake, dan ubah detail order

**Files:**
- Modify: `src/service-orders/dto/service-intake.dto.ts`
- Modify: `src/service-orders/dto/update-service-order.dto.ts`
- Modify: `src/service-orders/service-orders.service.ts` (`intake` ±baris 189, `update` ±baris 336)
- Test: `src/service-orders/service-orders.intake.spec.ts`, `src/service-orders/service-orders.update.spec.ts`

- [ ] **Step 1: Tulis tes yang gagal (intake)**

Tambahkan di AKHIR `service-orders.intake.spec.ts` (memakai `setup()` dan `customer` yang sudah ada di file itu; `plainToInstance`, `validate`, `ServiceIntakeDto` sudah diimpor di atas):

```ts
describe('ServiceOrdersService.intake — cara tagih', () => {
  const unit = { brand: 'LG', pk: 1 };

  it('bawaan API: ditagih_admin (app Flutter lama tidak mengirim field ini)', async () => {
    const { svc, tx } = setup();
    await svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit }, 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data).toMatchObject({ paymentMode: 'ditagih_admin' });
  });

  it('bayar_di_lokasi tersimpan bila dipilih (form web)', async () => {
    const { svc, tx } = setup();
    await svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit, paymentMode: 'bayar_di_lokasi' }, 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data).toMatchObject({ paymentMode: 'bayar_di_lokasi' });
  });

  it('DTO menolak cara tagih yang tidak dikenal', async () => {
    const dto = plainToInstance(ServiceIntakeDto, {
      customer: { name: 'Budi', phone: '0812', memberId: 'm1' },
      complaint: 'x',
      scheduledDate: '2026-11-10',
      paymentMode: 'kredit',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'paymentMode')).toBe(true);
  });
});
```

- [ ] **Step 2: Tulis tes yang gagal (update)**

Tambahkan di AKHIR `service-orders.update.spec.ts` (memakai `setup`, `order`, `job` yang ada):

```ts
describe('ServiceOrdersService.update — cara tagih', () => {
  it('mengganti paymentMode dan mencatatnya di audit log', async () => {
    const { svc, tx } = setup(order([job('j1')], { paymentMode: 'bayar_di_lokasi' }));
    await svc.update('o1', { paymentMode: 'ditagih_admin' }, 'admin1');
    expect(tx.serviceOrder.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { paymentMode: 'ditagih_admin' } });
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit.detail.changes.paymentMode).toEqual({ dari: 'bayar_di_lokasi', jadi: 'ditagih_admin' });
  });

  it('order pemasangan (POS) tidak bisa diganti cara tagihnya', async () => {
    const { svc, tx } = setup(order([job('j1', 'assigned', { type: 'pemasangan' })], { type: 'pemasangan', paymentMode: 'ditagih_admin' }));
    await expect(svc.update('o1', { paymentMode: 'bayar_di_lokasi' }, 'admin1')).rejects.toThrow('pemasangan');
    expect(tx.serviceOrder.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Jalankan dan pastikan gagal**

Run: `npx jest src/service-orders/service-orders.intake.spec.ts src/service-orders/service-orders.update.spec.ts -t "cara tagih"`
Expected: FAIL (TS error `paymentMode` tidak ada di DTO / properti tidak tersimpan).

- [ ] **Step 4: Tambah field DTO intake**

Di `service-intake.dto.ts`, tambah impor `import { PAYMENT_MODES } from '../payment-mode';` dan `import type { PaymentMode } from '../payment-mode';`, lalu di class `ServiceIntakeDto` sebelum `scheduledDate`:

```ts
  /**
   * Cara tagih order: 'bayar_di_lokasi' (bawaan; teknisi menagih di lokasi) atau 'ditagih_admin' (instansi/langganan,
   * admin menagih belakangan).
   */
  @IsOptional() @IsIn(PAYMENT_MODES, { message: 'Cara tagih hanya bayar_di_lokasi atau ditagih_admin' }) paymentMode?: PaymentMode;
```

- [ ] **Step 5: Tambah field DTO update**

Di `update-service-order.dto.ts`, tambah impor `import { PAYMENT_MODES } from '../payment-mode';` + `import type { PaymentMode } from '../payment-mode';` dan di class `UpdateServiceOrderDto` setelah field `note`:

```ts
  // Cara tagih (bayar_di_lokasi | ditagih_admin). Order pemasangan (POS) tidak bisa diganti.
  @IsOptional() @IsIn(PAYMENT_MODES, { message: 'Cara tagih hanya bayar_di_lokasi atau ditagih_admin' }) paymentMode?: PaymentMode;
```

- [ ] **Step 6: Simpan di intake**

Di `service-orders.service.ts`, pada `tx.serviceOrder.create` di `intake` tambahkan satu baris setelah `scheduledDate,`:

```ts
          paymentMode: dto.paymentMode ?? 'ditagih_admin', // bawaan API aman untuk app Flutter lama; form web memilih bayar_di_lokasi
```

- [ ] **Step 7: Terapkan di update**

Di `update()`:

1. Syarat "tidak ada perubahan" menjadi:

```ts
    if (
      dto.scheduledDate === undefined &&
      dto.jobType === undefined &&
      dto.note === undefined &&
      dto.paymentMode === undefined &&
      locations.length === 0
    ) {
```

2. Setelah blok penjagaan job komplain (`Jenis pekerjaan job komplain tidak bisa diganti`), tambahkan:

```ts
      if (dto.paymentMode !== undefined && (order.type === 'pemasangan' || open.some((j) => j.type === 'pemasangan'))) {
        throw new BadRequestException('Cara tagih order pemasangan tidak bisa diganti');
      }
```

3. Setelah blok `if (dto.note !== undefined) { ... }`, tambahkan:

```ts
      if (dto.paymentMode !== undefined) {
        orderData.paymentMode = dto.paymentMode;
        changes.paymentMode = { dari: order.paymentMode, jadi: dto.paymentMode };
      }
```

- [ ] **Step 8: Jalankan tes sampai lulus**

Run: `npx jest src/service-orders -t "cara tagih"`
Expected: PASS (5 tes). Lalu `npx jest src/service-orders` seluruhnya: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/service-orders
git commit -m "feat(servis): cara tagih order (bayar_di_lokasi / ditagih_admin) di Terima Servis dan Ubah Detail Order"
```

---

### Task 3: Pisahkan `setWithin` dari `ServicePricingService.set`

Refactor murni (perilaku tidak berubah); tes yang ada (`service-pricing.service.spec.ts`) adalah jaringan pengaman.

**Files:**
- Modify: `src/technician-jobs/service-pricing.service.ts` (`set`, ±baris 144–260)
- Modify: `src/technician-jobs/technician-jobs.module.ts`

- [ ] **Step 1: Pastikan tes yang ada hijau sebelum menyentuh**

Run: `npx jest src/technician-jobs/service-pricing.service.spec.ts`
Expected: PASS.

- [ ] **Step 2: Ubah `set` menjadi pembungkus transaksi**

Ganti kepala method (dua baris pertama dari `set`):

```ts
  async set(requestedJobId: string, dto: SetServicePricingDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const base = await tx.technicianJob.findUnique({ where: { id: requestedJobId }, select: { orderId: true } });
```

menjadi:

```ts
  async set(requestedJobId: string, dto: SetServicePricingDto, actorId: string) {
    return this.prisma.$transaction((tx) => this.setWithin(tx, requestedJobId, dto, actorId));
  }

  /**
   * Isi `set` di dalam transaksi milik pemanggil. Dipakai Terima Servis supaya order, job, dan harga perkiraan awal
   * tersimpan dalam SATU transaksi (gagal harga = order ikut batal).
   */
  async setWithin(tx: Prisma.TransactionClient, requestedJobId: string, dto: SetServicePricingDto, actorId: string) {
      const base = await tx.technicianJob.findUnique({ where: { id: requestedJobId }, select: { orderId: true } });
```

Lalu di akhir method, ganti penutup

```ts
      return { ok: true, invoice, jobTotal: result?.newTotal ?? 0, technicianId: job.technicianId };
    });
  }
}
```

menjadi

```ts
      return { ok: true, invoice, jobTotal: result?.newTotal ?? 0, technicianId: job.technicianId };
  }
}
```

(`Prisma` sudah diimpor di file ini. Isi `setWithin` sekarang menjorok dua spasi lebih dalam dari seharusnya; rapikan dengan mengurangi dua spasi pada seluruh isinya, atau jalankan `npx prettier --write src/technician-jobs/service-pricing.service.ts` dan pastikan `git diff` hanya berisi indentasi dan perubahan di atas.)

- [ ] **Step 3: Export dari modul**

Di `technician-jobs.module.ts` ubah baris export menjadi:

```ts
  exports: [TechnicianJobsService, ServicePricingService],
```

- [ ] **Step 4: Verifikasi**

Run: `npx tsc --noEmit && npx jest src/technician-jobs/service-pricing.service.spec.ts`
Expected: tsc bersih, PASS.

- [ ] **Step 5: Commit**

```bash
git add src/technician-jobs
git commit -m "refactor(servis): ServicePricingService.setWithin agar harga bisa diisi dalam transaksi pemanggil"
```

---

### Task 4: Harga perkiraan di Terima Servis

**Files:**
- Modify: `src/service-orders/dto/service-intake.dto.ts`
- Modify: `src/service-orders/service-orders.service.ts` (konstruktor, `intake`)
- Modify (sambungan konstruktor): `src/service-orders/service-orders.intake.spec.ts` (3 tempat), `src/service-orders/service-orders.update.spec.ts` (1 tempat)
- Test: `src/service-orders/service-orders.intake.spec.ts`

- [ ] **Step 1: Tulis tes yang gagal**

Di `service-orders.intake.spec.ts`:

(a) Ubah fungsi `setup()` (yang dipakai tes di atas, ±baris 28–52): tambahkan tiruan `pricing` dan teruskan sebagai argumen ke-5, lalu kembalikan:

```ts
  const pricing: any = { setWithin: jest.fn(async () => ({ ok: true })) };
  const svc = withDefaultSchedule(new ServiceOrdersService(prisma, {} as any, acUnits, technicianJobs, pricing));
  return { svc, tx, acUnits, technicianJobs, prisma, pricing };
```

(b) Pada `new ServiceOrdersService(...)` lain di file ini (±baris 118 dan ±515) tambahkan argumen ke-5 `{} as any`. Di `service-orders.update.spec.ts` (±baris 38) tambahkan juga `{} as any` sebagai argumen ke-5.

(c) Tambahkan di AKHIR file:

```ts
describe('ServiceOrdersService.intake — harga perkiraan di depan', () => {
  const unit = { brand: 'LG', pk: 1 };
  const lines = [{ serviceId: 's1', qty: 2, unitPrice: 75000 }];

  it('serviceLines: harga ditetapkan di transaksi yang sama untuk job pertama', async () => {
    const { svc, tx, pricing } = setup();
    await svc.intake(
      { customer, complaint: 'Cuci AC', newUnit: unit, serviceLines: lines, transportLevel: 1, transportMode: 'individu' },
      'a1',
    );
    expect(pricing.setWithin).toHaveBeenCalledWith(tx, 'j1', { lines, transportLevel: 1, transportMode: 'individu' }, 'a1');
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ priced: true });
  });

  it('tanpa serviceLines: harga tidak disentuh (perilaku lama)', async () => {
    const { svc, pricing } = setup();
    await svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit }, 'a1');
    expect(pricing.setWithin).not.toHaveBeenCalled();
  });

  it('transport tanpa baris jasa ditolak 400 sebelum transaksi dibuka', async () => {
    const { svc, prisma } = setup();
    await expect(svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit, transportLevel: 1 }, 'a1')).rejects.toThrow(
      'Transport hanya bisa diisi bersama baris jasa',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `npx jest src/service-orders/service-orders.intake.spec.ts -t "harga perkiraan"`
Expected: FAIL (konstruktor 5 argumen / `serviceLines` belum ada di DTO).

- [ ] **Step 3: Tambah field DTO**

Di `service-intake.dto.ts` tambahkan impor `import { ServicePricingLineDto } from '../../technician-jobs/dto/set-service-pricing.dto';` dan di class `ServiceIntakeDto` (setelah `paymentMode`):

```ts
  /**
   * Harga perkiraan jasa di depan (OPSIONAL): bentuknya sama dengan PUT /technician-jobs/:id/service-pricing. Satu harga
   * untuk seluruh order. Diisi → invoice langsung terbentuk dan teknisi bisa melihat harganya; admin boleh mengubahnya
   * lagi dari halaman job.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ServicePricingLineDto)
  serviceLines?: ServicePricingLineDto[];

  // Transport (0–5, N x Rp 100.000) dan modenya; hanya bermakna bersama serviceLines.
  @IsOptional() @IsInt() @Min(0) @Max(5) transportLevel?: number;
  @IsOptional() @IsIn(['individu', 'dibagi']) transportMode?: 'individu' | 'dibagi';
```

- [ ] **Step 4: Suntik `ServicePricingService`**

Di `service-orders.service.ts`: tambah impor `import { ServicePricingService } from '../technician-jobs/service-pricing.service';` dan tambahkan parameter konstruktor setelah `technicianJobs`:

```ts
    private readonly pricing: ServicePricingService,
```

- [ ] **Step 5: Validasi dan penetapan harga di `intake`**

Setelah pemeriksaan `Keluhan awal wajib diisi` (sebelum `if (dto.units?.length && ...`), tambahkan:

```ts
    if ((dto.transportLevel !== undefined || dto.transportMode !== undefined) && !dto.serviceLines?.length) {
      throw new BadRequestException('Transport hanya bisa diisi bersama baris jasa');
    }
```

Setelah loop `for (const [i, unit] of units.entries()) { ... }` dan SEBELUM `await tx.auditLog.create` di `intake`, tambahkan:

```ts
      // Harga perkiraan di depan: satu harga untuk seluruh order, ditetapkan lewat jalur yang sama dengan halaman job.
      if (dto.serviceLines?.length) {
        await this.pricing.setWithin(
          tx,
          jobs[0].id,
          { lines: dto.serviceLines, transportLevel: dto.transportLevel, transportMode: dto.transportMode },
          actorId,
        );
      }
```

Dan di `detail` audit `service_order.intake`, setelah spread `qrDulu`, tambahkan:

```ts
            ...(dto.serviceLines?.length ? { priced: true } : {}),
```

- [ ] **Step 6: Jalankan tes sampai lulus**

Run: `npx tsc --noEmit && npx jest src/service-orders`
Expected: tsc bersih, semua PASS.

- [ ] **Step 7: Commit**

```bash
git add src/service-orders
git commit -m "feat(servis): Terima Servis menerima harga perkiraan jasa di depan (satu transaksi dengan order)"
```

---

### Task 5: Invoice otomatis `batal` saat job terakhir dibatalkan

**Files:**
- Create: `src/technician-jobs/invoice-void.util.ts`
- Create: `src/technician-jobs/invoice-void.util.spec.ts`
- Modify: `src/technician-jobs/technician-jobs.service.ts` (impor, `cancel` ±baris 1827–1977)
- Modify: `src/technician-jobs/technician-jobs.multi-unit.spec.ts`

- [ ] **Step 1: Tulis tes util yang gagal**

Buat `src/technician-jobs/invoice-void.util.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { assertLastJobCancelAllowed, voidInvoiceIfOrderCancelled } from './invoice-void.util';

// Invoice servis dibatalkan (void, bukan dihapus) hanya bila SEMUA job order dibatalkan dan belum ada pembayaran.
// Pemasangan POS tidak disentuh (invoicenya penjualan).

const job = { id: 'j1', orderId: 'o1', type: 'perbaikan' };

function fakeTx(over: { invoiceId?: string | null; otherActive?: number; invoice?: { total_paid: string; status: string } | null } = {}) {
  const invoiceId = over.invoiceId === undefined ? 'inv1' : over.invoiceId;
  const invoice = over.invoice === undefined ? { total_paid: '0', status: 'lunas' } : over.invoice;
  return {
    serviceOrder: { findUnique: jest.fn(async () => ({ invoiceId })) },
    technicianJob: { count: jest.fn(async () => over.otherActive ?? 0) },
    $queryRaw: jest.fn(async () => (invoice ? [{ id: 'inv1', ...invoice }] : [])),
    invoice: { update: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  } as any;
}

describe('voidInvoiceIfOrderCancelled', () => {
  it('semua job dibatalkan dan belum ada pembayaran: invoice jadi batal + audit', async () => {
    const tx = fakeTx();
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(true);
    expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { status: 'batal' } });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      actorUid: 'a1',
      action: 'invoice.void_on_cancel',
      target: 'inv1',
    });
  });

  it('masih ada job lain yang tidak dibatalkan: invoice dibiarkan', async () => {
    const tx = fakeTx({ otherActive: 1 });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('pemasangan (invoice POS) tidak disentuh', async () => {
    const tx = fakeTx();
    await expect(voidInvoiceIfOrderCancelled(tx, { ...job, type: 'pemasangan' }, 'a1')).resolves.toBe(false);
    expect(tx.serviceOrder.findUnique).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });

  it('order belum punya invoice: tidak ada yang dilakukan', async () => {
    const tx = fakeTx({ invoiceId: null });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });

  it('sudah ada pembayaran: tidak dibatalkan', async () => {
    const tx = fakeTx({ invoice: { total_paid: '50000', status: 'dp' } });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });

  it('sudah batal: tidak diproses dua kali', async () => {
    const tx = fakeTx({ invoice: { total_paid: '0', status: 'batal' } });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('assertLastJobCancelAllowed', () => {
  it('job terakhir + invoice sudah punya pembayaran: ditolak (belum ada refund)', async () => {
    const tx = fakeTx({ invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, job)).rejects.toThrow(BadRequestException);
    await expect(assertLastJobCancelAllowed(tx, job)).rejects.toThrow('sudah punya pembayaran');
  });

  it('masih ada job lain: lolos walau sudah ada pembayaran', async () => {
    const tx = fakeTx({ otherActive: 1, invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, job)).resolves.toBeUndefined();
  });

  it('belum ada pembayaran: lolos', async () => {
    await expect(assertLastJobCancelAllowed(fakeTx(), job)).resolves.toBeUndefined();
  });

  it('pemasangan tidak diperiksa', async () => {
    const tx = fakeTx({ invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, { ...job, type: 'pemasangan' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `npx jest src/technician-jobs/invoice-void.util.spec.ts`
Expected: FAIL ("Cannot find module './invoice-void.util'").

- [ ] **Step 3: Tulis util**

Buat `src/technician-jobs/invoice-void.util.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, Prisma, TechnicianJobStatus } from '@prisma/client';

type Tx = Prisma.TransactionClient;
interface JobRef {
  id: string;
  orderId: string;
  type: string;
}

// Invoice servis yang dihargai di depan sudah ada sebelum pekerjaan selesai. Bila SEMUA job order dibatalkan, invoice itu
// dibatalkan (status `batal`, nomor + riwayat tetap ada) supaya tidak jadi invoice kosong. Pemasangan POS tidak disentuh:
// invoicenya adalah penjualan. Belum ada refund, jadi bila invoice sudah menerima pembayaran, pembatalan job terakhir ditolak.

async function lockInvoice(tx: Tx, invoiceId: string) {
  const rows = await tx.$queryRaw<{ id: string; total_paid: string; status: InvoiceStatus }[]>`
    SELECT id, total_paid, status FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
  return rows[0] ?? null;
}

/** Invoice servis order ini; null untuk pemasangan POS atau order yang belum punya invoice. */
async function serviceInvoiceId(tx: Tx, job: JobRef): Promise<string | null> {
  if (job.type === 'pemasangan') return null;
  const order = await tx.serviceOrder.findUnique({ where: { id: job.orderId }, select: { invoiceId: true } });
  return order?.invoiceId ?? null;
}

async function isLastActiveJob(tx: Tx, job: JobRef): Promise<boolean> {
  const others = await tx.technicianJob.count({
    where: { orderId: job.orderId, id: { not: job.id }, status: { not: TechnicianJobStatus.dibatalkan } },
  });
  return others === 0;
}

/** Dipanggil SEBELUM job dibatalkan: job terakhir tidak boleh dibatalkan bila invoice sudah punya pembayaran. */
export async function assertLastJobCancelAllowed(tx: Tx, job: JobRef): Promise<void> {
  const invoiceId = await serviceInvoiceId(tx, job);
  if (!invoiceId || !(await isLastActiveJob(tx, job))) return;
  const inv = await lockInvoice(tx, invoiceId);
  if (inv && Number(inv.total_paid) > 0) {
    throw new BadRequestException(
      'Invoice order ini sudah punya pembayaran, jadi job terakhirnya tidak bisa dibatalkan. Selesaikan pembayarannya dulu (sistem belum punya refund).',
    );
  }
}

/** Dipanggil SETELAH job dibatalkan dan tagihannya dihitung ulang. Mengembalikan true bila invoice dibatalkan. */
export async function voidInvoiceIfOrderCancelled(tx: Tx, job: JobRef, actorId: string): Promise<boolean> {
  const invoiceId = await serviceInvoiceId(tx, job);
  if (!invoiceId || !(await isLastActiveJob(tx, job))) return false;
  const inv = await lockInvoice(tx, invoiceId);
  if (!inv || inv.status === InvoiceStatus.batal || inv.status === InvoiceStatus.refund || Number(inv.total_paid) > 0) {
    return false;
  }
  await tx.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.batal } });
  await tx.auditLog.create({
    data: {
      actorUid: actorId,
      action: 'invoice.void_on_cancel',
      target: invoiceId,
      detail: { orderId: job.orderId, jobId: job.id },
    },
  });
  return true;
}
```

- [ ] **Step 4: Jalankan tes util sampai lulus**

Run: `npx jest src/technician-jobs/invoice-void.util.spec.ts`
Expected: PASS (10 tes).

- [ ] **Step 5: Tulis tes penyambungan yang gagal**

Di `technician-jobs.multi-unit.spec.ts`:

(a) Di bagian atas file (setelah `jest.mock('@nestjs/schedule', ...)`), tambahkan tiruan util dan impornya:

```ts
import { assertLastJobCancelAllowed, voidInvoiceIfOrderCancelled } from './invoice-void.util';
jest.mock('./invoice-void.util', () => ({
  assertLastJobCancelAllowed: jest.fn(async () => undefined),
  voidInvoiceIfOrderCancelled: jest.fn(async () => false),
}));
```

(b) Tambahkan di AKHIR file (memakai `cancelSetup()` yang ada):

```ts
describe('TechnicianJobsService.cancel — invoice order ikut dibatalkan', () => {
  beforeEach(() => {
    (assertLastJobCancelAllowed as jest.Mock).mockClear();
    (voidInvoiceIfOrderCancelled as jest.Mock).mockClear();
  });

  it('memeriksa pembayaran SEBELUM job dibatalkan, membatalkan invoice SETELAH tagihan dihitung ulang', async () => {
    const { svc, tx, jobBilling } = cancelSetup();
    await svc.cancel('j1', 'a1', 'admin');
    const ref = { id: 'j1', orderId: 'o1', type: 'perbaikan' };
    expect(assertLastJobCancelAllowed).toHaveBeenCalledWith(tx, ref);
    expect(voidInvoiceIfOrderCancelled).toHaveBeenCalledWith(tx, ref, 'a1');
    const guardAt = (assertLastJobCancelAllowed as jest.Mock).mock.invocationCallOrder[0];
    const updateAt = tx.technicianJob.update.mock.invocationCallOrder[0];
    const rebuildAt = jobBilling.rebuild.mock.invocationCallOrder[0];
    const voidAt = (voidInvoiceIfOrderCancelled as jest.Mock).mock.invocationCallOrder[0];
    expect(guardAt).toBeLessThan(updateAt);
    expect(rebuildAt).toBeLessThan(voidAt);
  });

  it('penjagaan menolak: job tidak diubah dan invoice tidak disentuh', async () => {
    (assertLastJobCancelAllowed as jest.Mock).mockRejectedValueOnce(new BadRequestException('sudah punya pembayaran'));
    const { svc, tx } = cancelSetup();
    await expect(svc.cancel('j1', 'a1', 'admin')).rejects.toThrow(BadRequestException);
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
    expect(voidInvoiceIfOrderCancelled).not.toHaveBeenCalled();
  });
});
```

(`BadRequestException` sudah diimpor di baris pertama file ini.)

- [ ] **Step 6: Jalankan dan pastikan gagal**

Run: `npx jest src/technician-jobs/technician-jobs.multi-unit.spec.ts -t "invoice order ikut dibatalkan"`
Expected: FAIL (`assertLastJobCancelAllowed` belum dipanggil dari `cancel`).

- [ ] **Step 7: Sambungkan ke `cancel()`**

Di `technician-jobs.service.ts`, tambah impor setelah impor `./job-assignees`:

```ts
import { assertLastJobCancelAllowed, voidInvoiceIfOrderCancelled } from './invoice-void.util';
```

Di `cancel()`, awal transaksi menjadi:

```ts
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const jobRef = { id: job.id, orderId: job.orderId, type: job.type };
      // Job terakhir order servis tidak boleh dibatalkan bila invoice-nya sudah menerima pembayaran (belum ada refund).
      await assertLastJobCancelAllowed(tx, jobRef);
      const updated = await tx.technicianJob.update({
        where: { id: jobId },
        data: { status: TechnicianJobStatus.dibatalkan, updatedAt: now },
      });
```

Dan di akhir transaksi, antara `if (successor?.billingDerived) await this.jobBilling.rebuild(...)` dan `return updated;`:

```ts
      // Semua job order dibatalkan dan belum ada pembayaran: invoice servis ikut dibatalkan (void, bukan dihapus).
      await voidInvoiceIfOrderCancelled(tx, jobRef, actorId);
```

- [ ] **Step 8: Jalankan tes sampai lulus**

Run: `npx tsc --noEmit && npx jest src/technician-jobs`
Expected: tsc bersih, semua PASS.

- [ ] **Step 9: Commit**

```bash
git add src/technician-jobs
git commit -m "feat(servis): invoice servis otomatis batal saat job terakhir order dibatalkan"
```

---

### Task 6: Invoice batal tidak bisa dikirim WA

**Files:**
- Modify: `src/invoices/invoices.service.ts` (`sendWhatsapp` ±baris 142)
- Create: `src/invoices/invoices.void.spec.ts`

- [ ] **Step 1: Tulis tes yang gagal**

Buat `src/invoices/invoices.void.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

describe('InvoicesService.sendWhatsapp — invoice batal', () => {
  it('invoice batal tidak dikirim ke pelanggan', async () => {
    const prisma: any = {
      invoice: {
        findUnique: jest.fn(async () => ({ id: 'i1', status: 'batal', items: [], member: null, adjustments: [], customerPhone: '0812' })),
      },
    };
    const whatsapp: any = { sendInvoiceMessage: jest.fn() };
    const svc = new InvoicesService(prisma, whatsapp, {} as any, {} as any, {} as any);
    await expect(svc.sendWhatsapp('i1', 'a1')).rejects.toThrow(BadRequestException);
    await expect(svc.sendWhatsapp('i1', 'a1')).rejects.toThrow('dibatalkan');
    expect(whatsapp.sendInvoiceMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `npx jest src/invoices/invoices.void.spec.ts`
Expected: FAIL (lolos sampai pemeriksaan PUBLIC_APP_URL / pesan galat berbeda).

- [ ] **Step 3: Tambah penjagaan**

Di `sendWhatsapp`, tepat setelah `if (!invoice) throw new NotFoundException('Invoice tidak ditemukan');`:

```ts
    if (invoice.status === 'batal') {
      throw new BadRequestException('Invoice ini sudah dibatalkan, tidak bisa dikirim ke pelanggan');
    }
```

- [ ] **Step 4: Jalankan dan commit**

Run: `npx jest src/invoices`
Expected: PASS.

```bash
git add src/invoices
git commit -m "fix(invoice): invoice batal tidak bisa dikirim lewat WhatsApp"
```

---

### Task 7: Laporan penjualan mengecualikan invoice `batal`

Hanya agregat tingkat invoice di `sales()` yang perlu diubah. Query berbasis baris item (`invoice_items`) tidak terpengaruh karena baris item job yang dibatalkan sudah dihapus oleh `rebuild`.

**Files:**
- Modify: `src/reports/reports.service.ts` (`sales`, ±baris 20, 57, 66)
- Create: `src/reports/reports.service.sales-batal.spec.ts`

- [ ] **Step 1: Tulis tes yang gagal**

Buat `src/reports/reports.service.sales-batal.spec.ts`:

```ts
import { ReportsService } from './reports.service';

// Invoice servis yang dibatalkan (status batal) tidak boleh ikut omzet/jumlah invoice/grafik harian/tipe pembeli.

function setup() {
  const sql: string[] = [];
  const prisma: any = {
    invoice: {
      aggregate: jest.fn(async () => ({
        _sum: { grandTotal: 0, subtotal: 0, discount: 0, taxAmount: 0 },
        _count: { _all: 0 },
      })),
      groupBy: jest.fn(async () => []),
    },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      sql.push(strings.join('?'));
      return [];
    }),
  };
  return { svc: new ReportsService(prisma), prisma, sql };
}

describe('ReportsService.sales — invoice batal', () => {
  it('total, grafik harian, kategori, dan tipe pembeli mengecualikan status batal', async () => {
    const { svc, prisma, sql } = setup();
    await svc.sales(new Date('2026-11-01'), new Date('2026-11-30'));
    expect(prisma.invoice.aggregate.mock.calls[0][0].where).toMatchObject({ status: { not: 'batal' } });
    expect(prisma.invoice.groupBy.mock.calls[0][0].where).toMatchObject({ status: { not: 'batal' } });
    expect(sql).toHaveLength(2);
    for (const q of sql) expect(q).toContain("<> 'batal'");
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `npx jest src/reports/reports.service.sales-batal.spec.ts`
Expected: FAIL (`where` tanpa `status`).

- [ ] **Step 3: Ubah query**

Di `reports.service.ts` tambahkan `InvoiceStatus` ke impor `@prisma/client` (impor ini sudah ada di file; kalau belum memuat `InvoiceStatus`, tambahkan ke daftar). Lalu di `sales()`:

1. `totals`: ganti `where: { createdAt: { gte: start, lte: end } },` (yang tepat di atas `_sum: {`) menjadi:

```ts
      where: { createdAt: { gte: start, lte: end }, status: { not: InvoiceStatus.batal } },
```

2. `byTier`: ganti `where: { createdAt: { gte: start, lte: end } },` (yang tepat di atas `_sum: { grandTotal: true },`) dengan baris yang sama seperti di atas.

3. `byCategory` (SQL): setelah baris `AND i.created_at BETWEEN ${start} AND ${end}` tambahkan baris:

```sql
        AND i.status <> 'batal'
```

4. `daily` (SQL): ganti `WHERE created_at BETWEEN ${start} AND ${end}` menjadi:

```sql
      WHERE created_at BETWEEN ${start} AND ${end}
        AND status <> 'batal'
```

- [ ] **Step 4: Jalankan dan commit**

Run: `npx tsc --noEmit && npx jest src/reports`
Expected: tsc bersih, PASS.

```bash
git add src/reports
git commit -m "fix(laporan): penjualan mengecualikan invoice batal"
```

---

### Task 8: Verifikasi menyeluruh dan dokumentasi

- [ ] **Step 1: Seluruh tes dan build backend**

Run: `npx tsc --noEmit && npx jest && npm run build`
Expected: tsc bersih; semua suite PASS (sebelumnya 52 suite / 533 tes, kini bertambah); build sukses.

- [ ] **Step 2: Cek manual jalur nyata (dengan DB lokal dan backend dinyalakan pengguna)**

Dengan token admin: `POST /service-orders/intake` berisi `serviceLines` → respons 201; `GET /technician-jobs/:id/service-pricing` menampilkan baris, `priced: true`, dan invoice `belum_dibayar`; lalu `PATCH /technician-jobs/:id/cancel` pada satu-satunya job → invoice berstatus `batal` (cek lewat `GET /invoices/:id` atau Prisma Studio), dan `POST /invoices/:id/send-whatsapp` → 400 "sudah dibatalkan". Jangan menyalakan Postgres/backend sendiri di mesin pengguna; minta pengguna.

- [ ] **Step 3: Perbarui CLAUDE.md (root `Nest/`, tidak ikut git)**

Tambahkan bullet di bagian 6 (Business rules) setelah bullet "Alih tugas":

```markdown
- **Cara tagih & harga di depan** (2026-11; migrasi `20261110000000_order_payment_mode`): `service_orders.payment_mode` = `bayar_di_lokasi` | `ditagih_admin` (bawaan DB `ditagih_admin`: order lama, pemasangan POS, dan app Flutter tidak berubah; Terima Servis web mengisi `bayar_di_lokasi` kecuali dipilih lain; diubah admin lewat `PATCH /service-orders/:id`, kecuali order pemasangan). `POST /service-orders/intake` menerima `serviceLines[]` + `transportLevel/transportMode` (opsional) → harga perkiraan ditetapkan lewat `ServicePricingService.setWithin` di transaksi yang sama (invoice langsung terbentuk). **Invoice servis otomatis `batal`** (void, bukan dihapus) saat SEMUA job order dibatalkan dan `totalPaid = 0` (`technician-jobs/invoice-void.util.ts`, audit `invoice.void_on_cancel`); membatalkan job terakhir yang invoice-nya sudah punya pembayaran ditolak (belum ada refund). Invoice `batal` tidak bisa dikirim WA dan tidak ikut `ReportsService.sales`. Spek lengkap alur pembayaran lapangan (belum dikerjakan selain bagian ini): `epos-backend/docs/superpowers/specs/2026-11-07-pembayaran-lapangan-teknisi-design.md`; rencana: `plans/2026-11-10-pembayaran-lapangan-00-peta.md`.
```

- [ ] **Step 4: Periksa diff**

Run: `git status --short && git log --oneline -7`
Expected: hanya berkas rencana ini (dan perubahan commit di atas); tidak ada `.env`, tidak ada berkas bukan-milik (`.codex/`, `Nest/.claude/`, `Nest/skills-lock.json`).

---

## Self-Review (terhadap spesifikasi)

- **Cara tagih per order** (spesifikasi: Data `payment_mode`, "Pelanggan ditagih belakangan… penanda per order"): Task 1–2. Ubah oleh admin: Task 2 (update).
- **Harga di depan** (Alur 1, "Jasa & Harga Perkiraan"): Task 3–4. Endpoint admin lain (`PUT service-pricing`) sudah ada dan tidak berubah.
- **Void otomatis** (Perilaku inti, keputusan 2026-11-10): Task 5; pembatalan ditolak bila sudah ada pembayaran: Task 5 `assertLastJobCancelAllowed`. Perluasan ke FieldPayment aktif ditunda ke rencana 3 (tabelnya belum ada).
- **Struk publik "Dibatalkan"** dan **daftar/dasbor mengecualikan `batal`**: dasbor piutang sudah hanya membaca `belum_dibayar|dp|kurang_bayar` (tidak berubah), laporan: Task 7, label web: rencana 5 (`lib/format.ts` dan filter Invoice sudah memuat `batal`).
- **Konsistensi nama**: `setWithin`, `assertLastJobCancelAllowed`, `voidInvoiceIfOrderCancelled`, `PAYMENT_MODES`/`PaymentMode`, `paymentMode` dipakai sama di semua task.
- **Cakupan di luar rencana ini (sengaja)**: teknisi melihat/mengedit harga (rencana 2), `field_payments` dan Tanda Terima (3), Setoran (4), UI (5), Flutter (6).
