# Harga Jasa untuk Teknisi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teknisi (assignee job) bisa melihat harga jasa yang ditetapkan admin dan menyesuaikannya di lokasi dengan batas: jumlah dan penghapusan baris boleh, baris baru dari katalog memakai harga katalog, di luar katalog hanya lewat "jasa lain" (nama + harga), semuanya wajib beralasan dan ditandai untuk admin.

**Architecture:** Memperluas `ServicePricingService` (rencana 1 sudah memisahkan `setWithin`). Kolom baru di `job_service_lines` (asal baris, penanda jasa lain, alasan) dan di `technician_jobs` (penanda "diubah teknisi" pada job pemegang harga). `GET service-pricing` dibuka untuk teknisi assignee; endpoint baru `PATCH :id/service-lines` khusus teknisi. Admin menyimpan harga lagi (`setWithin`) = penanda dihapus (dianggap sudah ditinjau).

**Tech Stack:** NestJS 11, Prisma 7 (migrasi SQL manual + `prisma generate`), class-validator, Jest 30 dengan prisma/tx tiruan.

Spesifikasi: `epos-backend/docs/superpowers/specs/2026-11-07-pembayaran-lapangan-teknisi-design.md` (bagian "Aturan penyesuaian jasa oleh teknisi"). Peta: `2026-11-10-pembayaran-lapangan-00-peta.md`. Rencana 1 (`…-01-harga-di-depan-dan-void.md`) sudah selesai.

**Catatan kerja:**
- Perintah dijalankan dari `Nest/epos-backend`. Pertahankan akhir-baris asli tiap berkas (`git ls-files --eol <path>`); berkas baru boleh LF.
- Commit **tanpa** baris `Co-Authored-By`. Jangan push. Jangan `git add` berkas docs/plans/specs, `.env`, `.codex/`, `Nest/.claude/`, `Nest/skills-lock.json`.
- Spec yang menyeret `reminders` perlu `jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }))`.
- Tidak ada UI web di rencana ini (rencana 5). Penguncian edit setelah ada pembayaran lapangan ditambahkan di rencana 3 (tabelnya belum ada).

---

## File Structure

| File | Aksi | Tanggung jawab |
|---|---|---|
| `prisma/schema.prisma` | Ubah | Kolom baru `JobServiceLine` dan `TechnicianJob` |
| `prisma/migrations/20261111000000_tech_price_edit/migration.sql` | Buat | `ALTER TABLE` kolom baru |
| `src/technician-jobs/dto/tech-edit-lines.dto.ts` | Buat | Body `PATCH :id/service-lines` |
| `src/technician-jobs/service-pricing.service.ts` | Ubah | `get` (field baru), `getFor`, `techEditLines`, `setWithin` menghapus penanda |
| `src/technician-jobs/technician-jobs.controller.ts` | Ubah | GET dibuka untuk teknisi, `PATCH :id/service-lines` |
| Spec: `service-pricing.tech-edit.spec.ts` (buat), `service-pricing.service.spec.ts` (ubah), `technician-jobs.controller.pricing.spec.ts` (buat) | | |
| `CLAUDE.md` (root `Nest/`) | Ubah | Catat fitur (tidak ikut git) |

---

### Task 1: Kolom baru (schema + migrasi)

**Files:**
- Modify: `prisma/schema.prisma` (model `JobServiceLine`, model `TechnicianJob`)
- Create: `prisma/migrations/20261111000000_tech_price_edit/migration.sql`

- [ ] **Step 1: Kolom di `JobServiceLine`**

Di model `JobServiceLine`, tepat setelah baris `position  Int           @default(0)`, sisipkan:

```prisma
  // Asal baris: 'admin' (ditetapkan admin/kasir) atau 'teknisi' (ditambah/diubah jumlahnya oleh teknisi di lokasi).
  // isCustom = "jasa lain" di luar katalog (nama + harga diisi teknisi, wajib beralasan).
  source       String  @default("admin")
  isCustom     Boolean @default(false) @map("is_custom")
  changeReason String? @map("change_reason")
```

- [ ] **Step 2: Kolom di `TechnicianJob`**

Di model `TechnicianJob`, di dekat kolom `transportLevel`/`transportMode`/`billingDerived` (cari dengan `grep -n "transportMode" prisma/schema.prisma`), sisipkan setelah baris `transportMode`:

```prisma
  // Penanda "jasa diubah teknisi" pada JOB PEMEGANG HARGA (lihat ServicePricingService.techEditLines). Dihapus saat admin/kasir
  // menyimpan harga lagi. priceBeforeTechEdit = subtotal jasa sebelum penyesuaian pertama sejak admin terakhir menyimpan.
  techPriceEditedAt   DateTime? @map("tech_price_edited_at")
  techPriceEditReason String?   @map("tech_price_edit_reason")
  priceBeforeTechEdit Decimal?  @map("price_before_tech_edit") @db.Decimal(14, 2)
```

- [ ] **Step 3: Migrasi**

Buat `prisma/migrations/20261111000000_tech_price_edit/migration.sql`:

```sql
-- Penyesuaian jasa oleh teknisi (spesifikasi pembayaran lapangan). Baris lama = ditetapkan admin.
ALTER TABLE "job_service_lines" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE "job_service_lines" ADD COLUMN "is_custom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "job_service_lines" ADD COLUMN "change_reason" TEXT;

ALTER TABLE "technician_jobs" ADD COLUMN "tech_price_edited_at" TIMESTAMP(3);
ALTER TABLE "technician_jobs" ADD COLUMN "tech_price_edit_reason" TEXT;
ALTER TABLE "technician_jobs" ADD COLUMN "price_before_tech_edit" DECIMAL(14,2);
```

- [ ] **Step 4: Terapkan, generate, typecheck, commit**

Run: `npx prisma validate && npx prisma migrate deploy && npx prisma generate && npx tsc --noEmit`
Expected: schema valid, migrasi `20261111000000_tech_price_edit` terpasang, client tergenerate, tsc bersih. (Jika Prisma terkunci karena backend berjalan atau DB tidak terjangkau: berhenti dan laporkan BLOCKED.)

```bash
git add prisma/schema.prisma prisma/migrations/20261111000000_tech_price_edit
git commit -m "feat(servis): kolom penyesuaian jasa oleh teknisi (source/isCustom/changeReason, penanda diubah teknisi)"
```

---

### Task 2: Membaca harga (`get` + `getFor`) dan admin menghapus penanda

**Files:**
- Modify: `src/technician-jobs/service-pricing.service.ts` (`get`, `setWithin`, method baru `getFor`; impor)
- Test: `src/technician-jobs/service-pricing.tech-edit.spec.ts` (buat; Task 3 menambah isinya), `src/technician-jobs/service-pricing.service.spec.ts` (ubah)

- [ ] **Step 1: Tulis tes yang gagal**

Buat `src/technician-jobs/service-pricing.tech-edit.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { ServicePricingService } from './service-pricing.service';

// Teknisi (assignee) boleh MELIHAT harga jasa job-nya; penyesuaian ada di blok describe berikutnya (Task 3).

describe('ServicePricingService.getFor — akses baca harga', () => {
  function make(isAssignee: boolean) {
    const prisma: any = { technicianJobAssignee: { count: jest.fn(async () => (isAssignee ? 1 : 0)) } };
    const svc = new ServicePricingService(prisma, {} as any, {} as any);
    const get = jest.spyOn(svc, 'get').mockResolvedValue({ jobId: 'j1' } as any);
    return { svc, prisma, get };
  }

  it('teknisi yang bukan assignee ditolak dan data tidak dibaca', async () => {
    const { svc, get } = make(false);
    await expect(svc.getFor('j1', 't9', 'teknisi')).rejects.toThrow(ForbiddenException);
    expect(get).not.toHaveBeenCalled();
  });

  it('teknisi assignee boleh membaca', async () => {
    const { svc, prisma, get } = make(true);
    await expect(svc.getFor('j1', 't1', 'teknisi')).resolves.toEqual({ jobId: 'j1' });
    expect(prisma.technicianJobAssignee.count).toHaveBeenCalledWith({ where: { jobId: 'j1', technicianId: 't1' } });
    expect(get).toHaveBeenCalledWith('j1');
  });

  it('admin/kasir tidak perlu menjadi assignee', async () => {
    const { svc, prisma, get } = make(false);
    await svc.getFor('j1', 'a1', 'admin');
    await svc.getFor('j1', 'k1', 'kasir');
    expect(prisma.technicianJobAssignee.count).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('ServicePricingService.get — field penyesuaian teknisi', () => {
  function make(over: Record<string, unknown> = {}) {
    const job = {
      id: 'j1', orderId: 'o1', type: 'cuci', status: 'sedang_dikerjakan', findingsSentAt: null, billingDerived: true,
      transportLevel: 0, transportMode: 'individu',
      techPriceEditedAt: null, techPriceEditReason: null, priceBeforeTechEdit: null,
      serviceLines: [
        { id: 'l1', serviceId: 's1', name: 'Cuci AC', qty: 3, unitPrice: 75000, source: 'teknisi', isCustom: false, changeReason: 'Unit ketiga ikut dicuci' },
      ],
      order: { invoiceId: 'inv1', invoice: { id: 'inv1', number: 'INV-1', status: 'belum_dibayar', grandTotal: 225000, totalPaid: 0 } },
      ...over,
    };
    const prisma: any = {
      technicianJob: {
        findUnique: jest.fn(async () => job),
        findFirst: jest.fn(async () => ({ id: 'j1' })),
        findMany: jest.fn(async () => [{ id: 'j1' }]),
      },
      materialRequest: { findMany: jest.fn(async () => []) },
      invoiceItem: { findMany: jest.fn(async () => []) },
    };
    return { svc: new ServicePricingService(prisma, {} as any, {} as any), job };
  }

  it('baris membawa source/isCustom/changeReason dan ada blok techEdit', async () => {
    const at = new Date('2026-11-11T03:00:00Z');
    const { svc } = make({ techPriceEditedAt: at, techPriceEditReason: 'Unit ketiga ikut dicuci', priceBeforeTechEdit: 150000 });
    const r = await svc.get('j1');
    expect(r.lines[0]).toMatchObject({ id: 'l1', source: 'teknisi', isCustom: false, changeReason: 'Unit ketiga ikut dicuci' });
    expect(r.techEdit).toEqual({ at, reason: 'Unit ketiga ikut dicuci', subtotalBefore: 150000, subtotalAfter: 225000 });
  });

  it('techEdit null bila jasa belum pernah disesuaikan teknisi', async () => {
    const { svc } = make();
    const r = await svc.get('j1');
    expect(r.techEdit).toBeNull();
  });
});
```

Tambahkan di `service-pricing.service.spec.ts`, dalam `describe('ServicePricingService.set — harga jasa satu untuk seluruh job', ...)` sebagai tes baru (memakai `setup`, `job`, `dto` yang sudah ada):

```ts
  it('admin menyimpan harga: penanda "diubah teknisi" dihapus dari job pemegang harga', async () => {
    const { svc, jobs } = setup([
      job('j1', 1, { techPriceEditedAt: new Date(), techPriceEditReason: 'x', priceBeforeTechEdit: 100 } as any),
    ]);
    await svc.set('j1', dto, 'a1');
    expect(jobs.get('j1')).toMatchObject({ techPriceEditedAt: null, techPriceEditReason: null, priceBeforeTechEdit: null });
  });
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `npx jest src/technician-jobs/service-pricing`
Expected: FAIL (`getFor` belum ada; `techEdit` belum ada; penanda belum dihapus).

- [ ] **Step 3: Implementasi**

Di `service-pricing.service.ts`:

1. Impor: ubah baris impor `@nestjs/common` menjadi `import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';` dan tambahkan `import { isJobAssignee } from './job-assignees';`.

2. Di `get()`, pada `lines: job.serviceLines.map((l) => ({ ... }))` tambahkan tiga properti setelah `unitPrice`:

```ts
        source: l.source,
        isCustom: l.isCustom,
        changeReason: l.changeReason,
```

dan tepat sebelum properti `transport: {` tambahkan:

```ts
      // Penanda untuk admin/kasir: jasa disesuaikan teknisi di lokasi (hilang saat admin menyimpan harga lagi).
      techEdit: job.techPriceEditedAt
        ? {
            at: job.techPriceEditedAt,
            reason: job.techPriceEditReason,
            subtotalBefore: Number(job.priceBeforeTechEdit ?? 0),
            subtotalAfter: job.serviceLines.reduce((s, l) => s + Math.round(Number(l.qty) * Number(l.unitPrice)), 0),
          }
        : null,
```

3. Tambah method tepat sebelum `get`:

```ts
  /** Ringkasan harga untuk peminta: admin/kasir bebas; teknisi hanya untuk job yang ia pegang (assignee). */
  async getFor(jobId: string, actorId: string, role: 'admin' | 'kasir' | 'teknisi' | 'gudang') {
    if (role === 'teknisi' && !(await isJobAssignee(this.prisma, jobId, actorId))) {
      throw new ForbiddenException('Job ini bukan milik Anda');
    }
    return this.get(jobId);
  }
```

4. Di `setWithin`, pada `tx.technicianJob.update({ where: { id: jobId }, data: { billingDerived: true, ...transport } })` tambahkan penanda dihapus:

```ts
          billingDerived: true,
          // Admin/kasir menyimpan harga = penyesuaian teknisi sudah ditinjau.
          techPriceEditedAt: null,
          techPriceEditReason: null,
          priceBeforeTechEdit: null,
```

(letakkan sebelum spread `...(dto.transportLevel !== undefined ...)`.)

- [ ] **Step 4: Jalankan tes sampai lulus**

Run: `npx tsc --noEmit && npx jest src/technician-jobs`
Expected: tsc bersih, semua PASS.

- [ ] **Step 5: Commit**

```bash
git add src/technician-jobs
git commit -m "feat(servis): teknisi assignee boleh membaca harga jasa, penanda diubah teknisi dihapus saat admin menyimpan"
```

---

### Task 3: Penyesuaian jasa oleh teknisi (`techEditLines`)

**Files:**
- Create: `src/technician-jobs/dto/tech-edit-lines.dto.ts`
- Modify: `src/technician-jobs/service-pricing.service.ts`
- Test: `src/technician-jobs/service-pricing.tech-edit.spec.ts` (tambah)

- [ ] **Step 1: DTO**

Buat `src/technician-jobs/dto/tech-edit-lines.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Satu baris dalam daftar jasa setelah disesuaikan teknisi. Tiga bentuk:
 *  - `id` (baris yang sudah ada): hanya `qty` yang boleh berubah; harga/nama tetap milik admin.
 *  - `serviceId` (tambah dari katalog): harga = harga katalog; `unitPrice` bila dikirim harus sama.
 *  - `name` + `unitPrice` (jasa lain, di luar katalog): keduanya wajib.
 */
export class TechEditLineDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsNumber() @Min(0.01) qty: number;
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
}

export class TechEditLinesDto {
  // Daftar LENGKAP jasa setelah disesuaikan (baris yang tidak ikut dikirim = dihapus). Minimal satu baris.
  @ValidateNested({ each: true })
  @Type(() => TechEditLineDto)
  @ArrayMinSize(1, { message: 'Minimal satu baris jasa' })
  @ArrayMaxSize(30)
  lines: TechEditLineDto[];

  // Alasan penyesuaian (wajib, min. 5 karakter setelah dipangkas); tampil ke admin dan masuk audit.
  @IsString() @MaxLength(500) reason: string;
}
```

- [ ] **Step 2: Tulis tes yang gagal**

Tambahkan di AKHIR `service-pricing.tech-edit.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

type Line = {
  id: string; jobId: string; serviceId: string | null; name: string; qty: number; unitPrice: number;
  position: number; source: string; isCustom: boolean;
};

const cuci: Line = { id: 'l1', jobId: 'j1', serviceId: 's-cuci', name: 'Cuci AC', qty: 2, unitPrice: 75000, position: 0, source: 'admin', isCustom: false };
const bongkar: Line = { id: 'l2', jobId: 'j1', serviceId: null, name: 'Bongkar pasang', qty: 1, unitPrice: 50000, position: 1, source: 'admin', isCustom: false };

function setupEdit(over: {
  status?: string; type?: string; complaintOfJobId?: string | null; assignee?: boolean; billingDerived?: boolean;
  invoiceId?: string | null; lines?: Line[]; editedAt?: Date | null; ownerStatus?: string;
} = {}) {
  const lines = over.lines ?? [cuci];
  const owner = {
    id: 'j1', orderId: 'o1', memberId: 'm1', type: over.type ?? 'cuci', status: over.ownerStatus ?? over.status ?? 'sedang_dikerjakan',
    complaintOfJobId: over.complaintOfJobId ?? null, billingDerived: over.billingDerived ?? true,
    techPriceEditedAt: over.editedAt ?? null, serviceLines: lines,
  };
  const services: Record<string, any> = {
    's-cuci': { id: 's-cuci', name: 'Cuci AC', basePrice: 75000, active: true },
    's-freon': { id: 's-freon', name: 'Isi Freon', basePrice: 200000, active: true },
    's-off': { id: 's-off', name: 'Jasa lama', basePrice: 1000, active: false },
  };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    technicianJobAssignee: { count: jest.fn(async () => (over.assignee === false ? 0 : 1)) },
    technicianJob: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === 'j1' ? { ...owner, status: over.status ?? owner.status } : null)),
      findFirst: jest.fn(async () => ({ id: 'j1' })),
      update: jest.fn(async () => ({})),
    },
    serviceOrder: { findUnique: jest.fn(async () => ({ id: 'o1', invoiceId: over.invoiceId === undefined ? 'inv1' : over.invoiceId })) },
    jobServiceLine: { delete: jest.fn(async () => ({})), update: jest.fn(async () => ({})), create: jest.fn(async () => ({})) },
    service: { findUnique: jest.fn(async ({ where }: any) => services[where.id] ?? null) },
    user: { findUnique: jest.fn(async () => ({ displayName: 'Budi' })) },
    member: { findUnique: jest.fn(async () => ({ name: 'Bu Sari' })) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const billing: any = { rebuild: jest.fn(async () => ({ newTotal: 350000 })) };
  const svc = new ServicePricingService(prisma, {} as any, billing);
  return { svc, tx, billing };
}

const alasan = 'Unit ketiga ikut dicuci';

describe('ServicePricingService.techEditLines — penyesuaian jasa oleh teknisi', () => {
  it('menaikkan jumlah baris admin: harga tetap, baris ditandai teknisi + alasan, tagihan dihitung ulang, admin ditandai', async () => {
    const { svc, tx, billing } = setupEdit();
    const r = await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 't1');
    expect(tx.jobServiceLine.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { qty: 3, position: 0, source: 'teknisi', changeReason: alasan },
    });
    expect(billing.rebuild).toHaveBeenCalledWith(tx, 'j1', 't1');
    const mark = tx.technicianJob.update.mock.calls[0][0];
    expect(mark.where).toEqual({ id: 'j1' });
    expect(mark.data).toMatchObject({ techPriceEditReason: alasan, priceBeforeTechEdit: 150000 });
    expect(mark.data.techPriceEditedAt).toBeInstanceOf(Date);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorUid: 't1', action: 'job.tech_edit_lines', target: 'j1' });
    expect(r).toMatchObject({ ok: true, jobId: 'j1', reason: alasan, subtotalBefore: 150000, subtotalAfter: 225000, actorName: 'Budi', customerName: 'Bu Sari' });
  });

  it('baris yang jumlahnya tidak berubah dipertahankan apa adanya (source tetap admin, tanpa alasan)', async () => {
    const { svc, tx } = setupEdit({ lines: [cuci, bongkar] });
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 3 }, { id: 'l2', qty: 1 }], reason: alasan }, 't1');
    expect(tx.jobServiceLine.update).toHaveBeenCalledWith({ where: { id: 'l2' }, data: { qty: 1, position: 1, source: 'admin' } });
  });

  it('tambah dari katalog: harga = harga katalog, ditandai teknisi', async () => {
    const { svc, tx } = setupEdit();
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 2 }, { serviceId: 's-freon', qty: 1 }], reason: 'Freon kurang' }, 't1');
    expect(tx.jobServiceLine.create).toHaveBeenCalledWith({
      data: { jobId: 'j1', serviceId: 's-freon', name: 'Isi Freon', qty: 1, unitPrice: 200000, position: 1, source: 'teknisi', isCustom: false, changeReason: 'Freon kurang' },
    });
  });

  it('jasa lain: nama + harga dari teknisi, ditandai isCustom', async () => {
    const { svc, tx } = setupEdit();
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 2 }, { name: ' Ganti kapasitor ', qty: 1, unitPrice: 120000 }], reason: 'Kapasitor rusak' }, 't1');
    expect(tx.jobServiceLine.create).toHaveBeenCalledWith({
      data: { jobId: 'j1', serviceId: null, name: 'Ganti kapasitor', qty: 1, unitPrice: 120000, position: 1, source: 'teknisi', isCustom: true, changeReason: 'Kapasitor rusak' },
    });
  });

  it('menghapus baris yang tidak ikut dikirim', async () => {
    const { svc, tx } = setupEdit({ lines: [cuci, bongkar] });
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 2 }, { name: 'Lain', qty: 1, unitPrice: 10000 }], reason: 'Bongkar pasang tidak jadi' }, 't1');
    expect(tx.jobServiceLine.delete).toHaveBeenCalledWith({ where: { id: 'l2' } });
  });

  it('penyesuaian kedua tidak menimpa subtotal awal admin (priceBeforeTechEdit)', async () => {
    const { svc, tx } = setupEdit({ editedAt: new Date('2026-11-11T01:00:00Z') });
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 4 }], reason: alasan }, 't1');
    expect(tx.technicianJob.update.mock.calls[0][0].data).not.toHaveProperty('priceBeforeTechEdit');
  });

  const tolak: [string, () => ReturnType<typeof setupEdit>, any, string][] = [
    ['harga baris admin tidak bisa diubah', () => setupEdit(), { lines: [{ id: 'l1', qty: 2, unitPrice: 10000 }], reason: alasan }, 'Harga satuan'],
    ['harga katalog tidak bisa diakali', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { serviceId: 's-freon', qty: 1, unitPrice: 5000 }], reason: alasan }, 'harga katalog'],
    ['jasa katalog nonaktif', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { serviceId: 's-off', qty: 1 }], reason: alasan }, 'nonaktif'],
    ['jasa katalog tidak ada', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { serviceId: 'x', qty: 1 }], reason: alasan }, 'tidak ditemukan'],
    ['jasa lain tanpa nama', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { qty: 1, unitPrice: 1000 }], reason: alasan }, 'Nama jasa lain'],
    ['jasa lain tanpa harga', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { name: 'Lain', qty: 1 }], reason: alasan }, 'Harga jasa lain'],
    ['id baris tidak dikenal', () => setupEdit(), { lines: [{ id: 'zzz', qty: 1 }], reason: alasan }, 'Baris jasa tidak ditemukan'],
    ['baris yang sama dikirim dua kali', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { id: 'l1', qty: 3 }], reason: alasan }, 'dua kali'],
    ['tanpa perubahan', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }], reason: alasan }, 'Tidak ada perubahan'],
    ['alasan terlalu pendek', () => setupEdit(), { lines: [{ id: 'l1', qty: 3 }], reason: '  ab ' }, 'Alasan'],
    ['daftar kosong', () => setupEdit(), { lines: [], reason: alasan }, 'Minimal satu baris'],
    ['job belum dihargai admin', () => setupEdit({ billingDerived: false }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'belum ditetapkan admin'],
    ['order tanpa invoice', () => setupEdit({ invoiceId: null }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'belum ditetapkan admin'],
    ['job menunggu review', () => setupEdit({ status: 'menunggu_review' }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'Ditugaskan atau Sedang Dikerjakan'],
    ['pemegang harga sudah selesai', () => setupEdit({ ownerStatus: 'selesai' }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'setelah job selesai'],
    ['job komplain', () => setupEdit({ complaintOfJobId: 'j0' }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'komplain'],
    ['pemasangan', () => setupEdit({ type: 'pemasangan' }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'pemasangan'],
  ];
  it.each(tolak)('ditolak 400: %s (tidak ada yang ditulis)', async (_nama, make, dto, pesan) => {
    const { svc, tx, billing } = make();
    await expect(svc.techEditLines('j1', dto, 't1')).rejects.toThrow(BadRequestException);
    await expect(svc.techEditLines('j1', dto, 't1')).rejects.toThrow(pesan);
    expect(tx.jobServiceLine.update).not.toHaveBeenCalled();
    expect(tx.jobServiceLine.create).not.toHaveBeenCalled();
    expect(tx.jobServiceLine.delete).not.toHaveBeenCalled();
    expect(billing.rebuild).not.toHaveBeenCalled();
  });

  it('bukan assignee job: 403', async () => {
    const { svc, tx } = setupEdit({ assignee: false });
    await expect(svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 't9')).rejects.toThrow(ForbiddenException);
    expect(tx.jobServiceLine.update).not.toHaveBeenCalled();
  });
});
```

Catatan untuk implementer: import `BadRequestException` ditaruh di bagian atas file bersama impor lain (jangan duplikasi impor di tengah file).

- [ ] **Step 3: Jalankan dan pastikan gagal**

Run: `npx jest src/technician-jobs/service-pricing.tech-edit.spec.ts`
Expected: FAIL (`techEditLines` belum ada).

- [ ] **Step 4: Implementasi**

Di `service-pricing.service.ts` tambahkan impor `import { TechEditLinesDto } from './dto/tech-edit-lines.dto';` lalu tambahkan method ini tepat sesudah `setWithin` (sebelum penutup kelas):

```ts
  /**
   * Teknisi (assignee) menyesuaikan jasa di lokasi. Aturan: harga satuan baris yang ada TIDAK bisa diubah (hanya jumlah),
   * baris baru dari katalog memakai harga katalog, di luar katalog hanya lewat "jasa lain" (nama + harga, ditandai isCustom).
   * Menghapus baris boleh. Alasan wajib. Transport tidak disentuh. Hasilnya ditandai untuk admin (techPriceEditedAt,
   * priceBeforeTechEdit) sampai admin menyimpan harga lagi (setWithin menghapus penanda). Harga satu untuk seluruh order:
   * ditulis ke job pemegang harga (sama seperti set).
   */
  async techEditLines(requestedJobId: string, dto: TechEditLinesDto, actorId: string) {
    const reason = dto.reason.trim();
    if (reason.length < 5) throw new BadRequestException('Alasan penyesuaian wajib diisi (min. 5 karakter)');
    if (dto.lines.length === 0) throw new BadRequestException('Minimal satu baris jasa');

    return this.prisma.$transaction(async (tx) => {
      const base = await tx.technicianJob.findUnique({
        where: { id: requestedJobId },
        select: { orderId: true, type: true, status: true, complaintOfJobId: true },
      });
      if (!base) throw new NotFoundException('Job tidak ditemukan');
      if (!(await isJobAssignee(tx, requestedJobId, actorId))) throw new ForbiddenException('Job ini bukan milik Anda');
      if (base.type === 'pemasangan') {
        throw new BadRequestException('Harga pemasangan mengikuti invoice POS, tidak bisa disesuaikan di sini');
      }
      if (base.complaintOfJobId) throw new BadRequestException('Job komplain tidak ditagih, tidak ada harga jasa');
      if (base.status !== TechnicianJobStatus.assigned && base.status !== TechnicianJobStatus.sedang_dikerjakan) {
        throw new BadRequestException('Jasa hanya bisa disesuaikan saat job Ditugaskan atau Sedang Dikerjakan');
      }

      // Urutan kunci sama dengan setWithin: order -> job pemegang harga.
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${base.orderId} FOR UPDATE`;
      const ownerId = await this.resolveOwnerId(tx, requestedJobId);
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE id = ${ownerId} FOR UPDATE`;
      const owner = await tx.technicianJob.findUnique({
        where: { id: ownerId },
        include: { serviceLines: { orderBy: { position: 'asc' } } },
      });
      if (!owner) throw new NotFoundException('Job tidak ditemukan');
      if (owner.status === TechnicianJobStatus.selesai || owner.status === TechnicianJobStatus.dibatalkan) {
        throw new BadRequestException('Harga jasa tidak bisa diubah setelah job selesai atau dibatalkan');
      }
      const order = await tx.serviceOrder.findUnique({ where: { id: owner.orderId }, select: { invoiceId: true } });
      if (!owner.billingDerived || !order?.invoiceId) {
        throw new BadRequestException('Harga jasa belum ditetapkan admin, jadi belum bisa disesuaikan');
      }

      // Susun daftar baru + validasi aturan per baris.
      const existing = new Map(owner.serviceLines.map((l) => [l.id, l]));
      const seen = new Set<string>();
      let changed = false;
      const next: {
        id?: string;
        serviceId: string | null;
        name: string;
        qty: number;
        unitPrice: number;
        isCustom: boolean;
        source: string;
        qtyChanged: boolean;
      }[] = [];
      for (const l of dto.lines) {
        if (l.id) {
          const old = existing.get(l.id);
          if (!old) throw new BadRequestException('Baris jasa tidak ditemukan di job ini');
          if (seen.has(l.id)) throw new BadRequestException('Baris jasa yang sama dikirim dua kali');
          seen.add(l.id);
          if (l.unitPrice !== undefined && l.unitPrice !== Number(old.unitPrice)) {
            throw new BadRequestException('Harga satuan jasa tidak bisa diubah teknisi; tambahkan sebagai jasa lain bila perlu');
          }
          const qtyChanged = Number(old.qty) !== l.qty;
          if (qtyChanged) changed = true;
          next.push({
            id: old.id, serviceId: old.serviceId, name: old.name, qty: l.qty, unitPrice: Number(old.unitPrice),
            isCustom: old.isCustom, source: qtyChanged ? 'teknisi' : old.source, qtyChanged,
          });
        } else if (l.serviceId) {
          const svc = await tx.service.findUnique({ where: { id: l.serviceId } });
          if (!svc) throw new BadRequestException('Jasa tidak ditemukan');
          if (!svc.active) throw new BadRequestException('Jasa sudah nonaktif');
          if (l.unitPrice !== undefined && l.unitPrice !== Number(svc.basePrice)) {
            throw new BadRequestException('Harga jasa katalog mengikuti harga katalog; di luar katalog pakai jasa lain');
          }
          changed = true;
          next.push({ serviceId: svc.id, name: svc.name, qty: l.qty, unitPrice: Number(svc.basePrice), isCustom: false, source: 'teknisi', qtyChanged: true });
        } else {
          const name = l.name?.trim();
          if (!name) throw new BadRequestException('Nama jasa lain wajib diisi');
          if (l.unitPrice === undefined) throw new BadRequestException('Harga jasa lain wajib diisi');
          changed = true;
          next.push({ serviceId: null, name, qty: l.qty, unitPrice: l.unitPrice, isCustom: true, source: 'teknisi', qtyChanged: true });
        }
      }
      const removed = owner.serviceLines.filter((l) => !seen.has(l.id));
      if (removed.length > 0) changed = true;
      if (!changed) throw new BadRequestException('Tidak ada perubahan');

      const subtotal = (rows: { qty: number | { toString(): string }; unitPrice: number | { toString(): string } }[]) =>
        rows.reduce((s, r) => s + Math.round(Number(r.qty) * Number(r.unitPrice)), 0);
      const subtotalBefore = subtotal(owner.serviceLines);
      const subtotalAfter = subtotal(next);

      for (const old of removed) await tx.jobServiceLine.delete({ where: { id: old.id } });
      for (const [i, n] of next.entries()) {
        if (n.id) {
          await tx.jobServiceLine.update({
            where: { id: n.id },
            data: { qty: n.qty, position: i, source: n.source, ...(n.qtyChanged ? { changeReason: reason } : {}) },
          });
        } else {
          await tx.jobServiceLine.create({
            data: {
              jobId: ownerId, serviceId: n.serviceId, name: n.name, qty: n.qty, unitPrice: n.unitPrice,
              position: i, source: 'teknisi', isCustom: n.isCustom, changeReason: reason,
            },
          });
        }
      }
      await tx.technicianJob.update({
        where: { id: ownerId },
        data: {
          techPriceEditedAt: new Date(),
          techPriceEditReason: reason,
          // Subtotal awal admin dicatat sekali (penyesuaian pertama sejak admin terakhir menyimpan harga).
          ...(owner.techPriceEditedAt ? {} : { priceBeforeTechEdit: subtotalBefore }),
        },
      });
      const result = await this.billing.rebuild(tx, ownerId, actorId);

      const summarize = (rows: { name: string; qty: number | { toString(): string }; unitPrice: number | { toString(): string } }[]) =>
        rows.map((r) => ({ name: r.name, qty: Number(r.qty), unitPrice: Number(r.unitPrice) }));
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'job.tech_edit_lines',
          target: ownerId,
          detail: {
            requestedJobId, reason, subtotalBefore, subtotalAfter,
            before: summarize(owner.serviceLines), after: summarize(next),
          },
        },
      });

      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { displayName: true } });
      const member = owner.memberId ? await tx.member.findUnique({ where: { id: owner.memberId }, select: { name: true } }) : null;
      return {
        ok: true,
        jobId: ownerId,
        reason,
        subtotalBefore,
        subtotalAfter,
        jobTotal: result?.newTotal ?? 0,
        actorName: actor?.displayName ?? 'Teknisi',
        customerName: member?.name ?? null,
      };
    });
  }
```

Catatan: pesan galat harus mengandung teks yang dicari tes (`Harga satuan`, `harga katalog`, `nonaktif`, `tidak ditemukan`, `Nama jasa lain`, `Harga jasa lain`, `Baris jasa tidak ditemukan`, `dua kali`, `Tidak ada perubahan`, `Alasan`, `Minimal satu baris`, `belum ditetapkan admin`, `Ditugaskan atau Sedang Dikerjakan`, `setelah job selesai`, `komplain`, `pemasangan`). Bila `tsc` mengeluh soal tipe `Decimal` pada `subtotal`, sesuaikan tipe parameter seminimal mungkin (mis. `{ qty: unknown; unitPrice: unknown }`) tanpa mengubah perilaku.

- [ ] **Step 5: Jalankan tes sampai lulus**

Run: `npx tsc --noEmit && npx jest src/technician-jobs`
Expected: tsc bersih, semua PASS.

- [ ] **Step 6: Commit**

```bash
git add src/technician-jobs
git commit -m "feat(servis): teknisi bisa menyesuaikan jasa di lokasi (katalog + jumlah + jasa lain), wajib beralasan, ditandai untuk admin"
```

---

### Task 4: Endpoint (GET dibuka untuk teknisi, PATCH service-lines)

**Files:**
- Modify: `src/technician-jobs/technician-jobs.controller.ts`
- Test: `src/technician-jobs/technician-jobs.controller.pricing.spec.ts` (buat)

- [ ] **Step 1: Tulis tes yang gagal**

Buat `src/technician-jobs/technician-jobs.controller.pricing.spec.ts`:

```ts
import { TechnicianJobsController } from './technician-jobs.controller';

// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

function make() {
  const pricing: any = {
    getFor: jest.fn(async () => ({ jobId: 'j1' })),
    techEditLines: jest.fn(async () => ({
      ok: true, jobId: 'j1', reason: 'Unit ketiga ikut dicuci', subtotalBefore: 150000, subtotalAfter: 225000,
      actorName: 'Budi', customerName: 'Bu Sari',
    })),
  };
  const realtime: any = { emitToAdmin: jest.fn() };
  const notifications: any = { notifyRoles: jest.fn(async () => undefined) };
  const ctrl = new TechnicianJobsController({} as any, realtime, {} as any, notifications, pricing);
  return { ctrl, pricing, realtime, notifications };
}

describe('TechnicianJobsController — harga jasa untuk teknisi', () => {
  it('GET service-pricing meneruskan peminta (teknisi dicek assignee di service)', async () => {
    const { ctrl, pricing } = make();
    await expect(ctrl.getServicePricing('j1', { sub: 't1', role: 'teknisi' } as any)).resolves.toEqual({ jobId: 'j1' });
    expect(pricing.getFor).toHaveBeenCalledWith('j1', 't1', 'teknisi');
  });

  it('PATCH service-lines: panggil service, kabari admin lewat realtime dan admin+kasir lewat notifikasi', async () => {
    const { ctrl, pricing, realtime, notifications } = make();
    const dto: any = { lines: [{ id: 'l1', qty: 3 }], reason: 'Unit ketiga ikut dicuci' };
    const r = await ctrl.techEditServiceLines('j1', dto, { sub: 't1', role: 'teknisi' } as any);
    expect(pricing.techEditLines).toHaveBeenCalledWith('j1', dto, 't1');
    expect(realtime.emitToAdmin).toHaveBeenCalledWith('job.price_edited', { jobId: 'j1' });
    const [roles, payload] = notifications.notifyRoles.mock.calls[0];
    expect(roles).toEqual(['admin', 'kasir']);
    expect(payload).toMatchObject({ type: 'job_price_edited', target: 'j1', title: 'Jasa Disesuaikan Teknisi' });
    expect(payload.body).toContain('Budi');
    expect(payload.body).toContain('Bu Sari');
    expect(payload.body).toContain('Unit ketiga ikut dicuci');
    expect(r).toMatchObject({ ok: true, subtotalAfter: 225000 });
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `npx jest src/technician-jobs/technician-jobs.controller.pricing.spec.ts`
Expected: FAIL (`techEditServiceLines` belum ada / `getServicePricing` tidak menerima peminta).

- [ ] **Step 3: Implementasi**

Di `technician-jobs.controller.ts`:

1. Tambah impor `import { TechEditLinesDto } from './dto/tech-edit-lines.dto';` di dekat impor `SetServicePricingDto`.

2. Ganti blok GET:

```ts
  // Harga jasa servis (admin & kasir) — dilihat dan ditetapkan dari halaman job.
  @Roles('admin', 'kasir')
  @Get(':id/service-pricing')
  getServicePricing(@Param('id') id: string) {
    return this.pricing.get(id);
  }
```

menjadi:

```ts
  // Harga jasa servis — dilihat admin & kasir (dan ditetapkan lewat PUT), serta teknisi assignee job itu (baca saja;
  // pengecekan kepemilikan ada di service).
  @Roles('admin', 'kasir', 'teknisi')
  @Get(':id/service-pricing')
  getServicePricing(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.pricing.getFor(id, user.sub, user.role);
  }
```

3. Tepat sesudah method `setServicePricing` tambahkan:

```ts
  // Teknisi menyesuaikan jasa di lokasi (katalog + jumlah + "jasa lain"), wajib beralasan. Admin & kasir dikabari.
  @Roles('teknisi')
  @Patch(':id/service-lines')
  async techEditServiceLines(
    @Param('id') id: string,
    @Body() dto: TechEditLinesDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const r = await this.pricing.techEditLines(id, dto, user.sub);
    this.realtime.emitToAdmin('job.price_edited', { jobId: id });
    const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
    void this.notifications
      .notifyRoles(['admin', 'kasir'], {
        title: 'Jasa Disesuaikan Teknisi',
        body: `${r.actorName} menyesuaikan jasa${r.customerName ? ` untuk ${r.customerName}` : ''}: ${rp(r.subtotalBefore)} menjadi ${rp(r.subtotalAfter)}. Alasan: ${r.reason}`,
        type: 'job_price_edited',
        target: id,
      })
      .catch(() => undefined);
    return r;
  }
```

- [ ] **Step 4: Jalankan tes sampai lulus**

Run: `npx tsc --noEmit && npx jest src/technician-jobs`
Expected: tsc bersih, semua PASS. Pastikan juga tidak ada panggilan lain ke `getServicePricing(` dengan satu argumen: `grep -rn "getServicePricing(" src`.

- [ ] **Step 5: Commit**

```bash
git add src/technician-jobs
git commit -m "feat(servis): endpoint teknisi: lihat harga jasa dan PATCH service-lines (admin & kasir dikabari)"
```

---

### Task 5: Verifikasi dan dokumentasi

- [ ] **Step 1: Seluruh tes dan build**

Run: `npx tsc --noEmit && npx jest && npm run build`
Expected: tsc bersih; semua suite PASS; build sukses.

- [ ] **Step 2: CLAUDE.md (root `Nest/`, tidak ikut git)**

Tambahkan bullet tepat sesudah bullet "Cara tagih & harga di depan":

```markdown
- **Harga jasa untuk teknisi** (2026-11; migrasi `20261111000000_tech_price_edit`; rencana 2 pembayaran lapangan): teknisi assignee boleh MELIHAT harga jasa job-nya (`GET /technician-jobs/:id/service-pricing`, kini juga untuk `teknisi`; `ServicePricingService.getFor` mengecek assignee) dan MENYESUAIKANNYA di lokasi lewat `PATCH /technician-jobs/:id/service-lines` (`techEditLines`): body `{ lines[], reason }` = daftar LENGKAP jasa setelah disesuaikan. Aturan: baris yang ada hanya boleh diubah jumlahnya (harga satuan admin dikunci, 400 bila dikirim berbeda), baris baru dari katalog memakai `Service.basePrice`, di luar katalog hanya "jasa lain" (`isCustom`, nama + harga wajib), baris yang tidak dikirim dihapus, alasan wajib (≥5 karakter), transport tidak disentuh; hanya saat job `assigned`/`sedang_dikerjakan`, harus sudah dihargai admin (`billingDerived` + invoice), bukan komplain/pemasangan. Ditulis ke job pemegang harga; kolom baru `job_service_lines.source/is_custom/change_reason` dan penanda `technician_jobs.tech_price_edited_at/tech_price_edit_reason/price_before_tech_edit` (muncul sebagai `techEdit` di respons `service-pricing`; hilang saat admin/kasir menyimpan harga lagi lewat `PUT`). Admin & kasir dikabari (notif `job_price_edited`, realtime `job.price_edited`, audit `job.tech_edit_lines`). Belum: UI web/Flutter, notifikasi `job_price_edited` belum punya ikon/tujuan di lonceng web, dan penguncian edit setelah ada pembayaran lapangan (rencana 3).
```

- [ ] **Step 3: Periksa diff**

Run: `git status --short && git log --oneline -6`
Expected: hanya berkas docs/plans/specs/`.codex`/`Nest/.claude`/`skills-lock.json` yang untracked; commit rencana ini terlihat.

---

## Self-Review (terhadap spesifikasi)

- **Teknisi melihat harga, tanpa harga beli/margin** (Hak akses): Task 2 & 4 — `get()` tidak memuat harga beli; assignee dicek.
- **Katalog + jumlah, harga terkunci; jasa lain ditandai; alasan wajib; hapus baris; transport/diskon tidak bisa diubah; satu harga per order**: Task 3.
- **Ditandai untuk admin; admin bisa mengoreksi** (PUT yang ada) **dan penanda hilang**: Task 1–2 (kolom, `techEdit`, `setWithin` mereset).
- **Admin & kasir dikabari**: Task 4.
- **Terkunci setelah ada pembayaran lapangan**: sengaja ditunda ke rencana 3 (tabel `field_payments` belum ada); dicatat di CLAUDE.md.
- **Job komplain / pemasangan tidak punya UI harga**: Task 3 menolak keduanya.
- **Konsistensi nama**: `getFor`, `techEditLines`, `TechEditLinesDto`, `techEdit`, `job_price_edited`, `job.price_edited`, `job.tech_edit_lines` dipakai sama di semua task.
