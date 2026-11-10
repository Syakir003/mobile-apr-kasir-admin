# Pembayaran Lapangan + Tanda Terima Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teknisi assignee mencatat pembayaran yang ia terima di lokasi (nominal, metode, foto bukti) pada order `bayar_di_lokasi`, lalu mengirim Tanda Terima singkat ke pelanggan lewat WhatsApp nomor toko (atau menandai pakai laporan kertas). Pembayaran ini BELUM melunasi invoice (itu rencana 4); di sini hanya dicatat dengan status, dengan semua gerbang dan penjaga yang melindunginya.

**Architecture:** Modul baru `src/field-payments/` (service, controller, DTO, util pesan). Tabel baru `field_payments`. Gerbang di satu fungsi (`gateReason`) yang dipakai `record` dan ringkasan layar teknisi. Penjaga di tempat lain: `PaymentsService.record` (jangan ganda bayar), `techEditLines` (kunci jasa setelah Tanda Terima terbit), `assertLastJobCancelAllowed` (jangan batalkan job terakhir saat ada uang dipegang), dan gerbang Ajukan Selesai (`payment-gate.util.ts`).

**Tech Stack:** NestJS 11, Prisma 7 (migrasi SQL manual + `prisma generate`), multer (`photoUploadOptions`), class-validator, Jest 30 dengan prisma/tx tiruan.

Spesifikasi: `epos-backend/docs/superpowers/specs/2026-11-07-pembayaran-lapangan-teknisi-design.md`. Peta: `2026-11-10-pembayaran-lapangan-00-peta.md`. Rencana 1–2 sudah selesai.

**Catatan kerja:**
- Perintah dijalankan dari `Nest/epos-backend`. Pertahankan akhir-baris asli tiap berkas (`git ls-files --eol <path>`); berkas baru boleh LF.
- Commit **tanpa** baris `Co-Authored-By`. Jangan push. Jangan `git add` berkas docs/plans/specs, `.env`, `.codex/`, `Nest/.claude/`, `Nest/skills-lock.json`.
- Spec yang mengimpor service yang menyeret `reminders` perlu `jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }))`.
- Beberapa tugas menyentuh service yang sudah punya spec dengan tx tiruan; bila tx tiruan itu belum punya method baru (mis. `fieldPayment`, `serviceOrder.findUnique`), tambahkan ke tiruan itu seminimal mungkin (atau `jest.mock` util barunya di spec itu) dan laporkan.
- Pembayaran lapangan TIDAK menyentuh `invoices.total_paid` / `status`. Pelunasan = rencana 4.
- Status yang dianggap AKTIF (uang masih di teknisi / menunggu dicocokkan): `dipegang_teknisi`, `menunggu_cocok`.

---

## File Structure

| File | Aksi | Tanggung jawab |
|---|---|---|
| `prisma/schema.prisma` | Ubah | Model `FieldPayment`, kolom `ServiceOrder.unpaidReason`, enum `WhatsappMessageKind.tanda_terima`, relasi balik |
| `prisma/migrations/20261112000000_field_payments/migration.sql` | Buat | Tabel, kolom, nilai enum |
| `src/field-payments/field-payment.constants.ts` | Buat | Status, metode, label |
| `src/field-payments/receipt-message.util.ts` | Buat | Teks Tanda Terima WA |
| `src/field-payments/dto/create-field-payment.dto.ts`, `dto/send-receipt.dto.ts` | Buat | Body request |
| `src/field-payments/field-payments.service.ts` | Buat | `gateReason`, `record`, `sendReceipt`, `listForJob`, `mine` |
| `src/field-payments/field-payments.controller.ts`, `field-payments.module.ts` | Buat | Rute + modul |
| `src/app.module.ts` | Ubah | Daftarkan modul |
| `src/whatsapp/whatsapp.service.ts` | Ubah | `sendInvoiceMessage` menerima `kind` |
| `src/payments/payments.service.ts` | Ubah | Penjaga ganda bayar |
| `src/technician-jobs/service-pricing.service.ts` | Ubah | Kunci `techEditLines` |
| `src/technician-jobs/invoice-void.util.ts` | Ubah | `assertLastJobCancelAllowed` menolak bila ada pembayaran aktif |
| `src/technician-jobs/payment-gate.util.ts` | Buat | Gerbang Ajukan Selesai |
| `src/technician-jobs/technician-jobs.service.ts`, `technician-jobs.controller.ts`, `dto/submit-for-review.dto.ts` | Ubah | Memasang gerbang + `unpaidReason` |
| Spec baru: `receipt-message.util.spec.ts`, `field-payments.service.spec.ts`, `field-payments.send-receipt.spec.ts`, `field-payments.controller.spec.ts`, `payments.service.field.spec.ts`, `payment-gate.util.spec.ts`; ubah: `service-pricing.tech-edit.spec.ts`, `invoice-void.util.spec.ts`, `whatsapp` spec bila ada | | |
| `CLAUDE.md` (root `Nest/`) | Ubah | Catat fitur (tidak ikut git) |

---

### Task 1: Skema + migrasi

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261112000000_field_payments/migration.sql`

- [ ] **Step 1: Enum WhatsApp**

Di `enum WhatsappMessageKind`, tambahkan nilai setelah `menang_undian`:

```prisma
  tanda_terima
```

- [ ] **Step 2: Kolom di `ServiceOrder`**

Di model `ServiceOrder`, setelah baris `paymentMode`, tambahkan relasi dan kolom:

```prisma
  // Alasan teknisi mengajukan selesai TANPA mencatat pembayaran pada order bayar_di_lokasi (mis. pelanggan belum bisa membayar).
  unpaidReason String? @map("unpaid_reason")
  fieldPayments FieldPayment[]
```

- [ ] **Step 3: Relasi balik**

Di model `Invoice` (dekat `manualPayments ManualPayment[]`) tambahkan `fieldPayments FieldPayment[]`. Di model `User` (dekat `jobAssignments`) tambahkan `fieldPaymentsRecorded FieldPayment[] @relation("FieldPaymentRecordedBy")`.

- [ ] **Step 4: Model `FieldPayment`**

Tambahkan di bagian "INVOICE & PEMBAYARAN MANUAL", sesudah model `ManualPayment`:

```prisma
// Pembayaran yang diterima teknisi di lokasi (order bayar_di_lokasi). BELUM melunasi invoice: baru dihitung (menjadi
// ManualPayment) setelah admin memverifikasi setoran/mutasi. Status AKTIF = dipegang_teknisi (tunai) atau menunggu_cocok
// (non-tunai); lainnya diverifikasi / ditolak.
model FieldPayment {
  id             String       @id @default(uuid())
  invoiceId      String       @map("invoice_id")
  invoice        Invoice      @relation(fields: [invoiceId], references: [id])
  orderId        String       @map("order_id")
  order          ServiceOrder @relation(fields: [orderId], references: [id])
  recordedById   String       @map("recorded_by")
  recordedBy     User         @relation("FieldPaymentRecordedBy", fields: [recordedById], references: [id])
  method         String // 'tunai' | 'transfer' | 'qris' | 'ewallet' | 'debit'
  amount         Decimal      @db.Decimal(14, 2)
  note           String?
  proofUrl       String       @map("proof_url")
  status         String // 'dipegang_teknisi' | 'menunggu_cocok' | 'diverifikasi' | 'ditolak'
  receiptNumber  String       @unique @map("receipt_number")
  receiptChannel String?      @map("receipt_channel") // 'wa' | 'kertas'
  receiptSentAt  DateTime?    @map("receipt_sent_at")
  receiptWaLogId String?      @map("receipt_wa_log_id")
  paperReportNo  String?      @map("paper_report_no")
  clientRef      String?      @unique @map("client_ref")
  createdAt      DateTime     @default(now()) @map("created_at")

  @@index([invoiceId, status])
  @@index([orderId])
  @@index([recordedById, status])
  @@map("field_payments")
}
```

- [ ] **Step 5: Migrasi**

Buat `prisma/migrations/20261112000000_field_payments/migration.sql`:

```sql
-- Pembayaran lapangan teknisi + Tanda Terima (spesifikasi pembayaran lapangan, rencana 3).
ALTER TYPE "WhatsappMessageKind" ADD VALUE 'tanda_terima';

ALTER TABLE "service_orders" ADD COLUMN "unpaid_reason" TEXT;

CREATE TABLE "field_payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "proof_url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "receipt_channel" TEXT,
    "receipt_sent_at" TIMESTAMP(3),
    "receipt_wa_log_id" TEXT,
    "paper_report_no" TEXT,
    "client_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "field_payments_receipt_number_key" ON "field_payments"("receipt_number");
CREATE UNIQUE INDEX "field_payments_client_ref_key" ON "field_payments"("client_ref");
CREATE INDEX "field_payments_invoice_id_status_idx" ON "field_payments"("invoice_id", "status");
CREATE INDEX "field_payments_order_id_idx" ON "field_payments"("order_id");
CREATE INDEX "field_payments_recorded_by_status_idx" ON "field_payments"("recorded_by", "status");

ALTER TABLE "field_payments" ADD CONSTRAINT "field_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_payments" ADD CONSTRAINT "field_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "service_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_payments" ADD CONSTRAINT "field_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 6: Terapkan, generate, typecheck, commit**

Run: `npx prisma validate && npx prisma migrate deploy && npx prisma generate && npx tsc --noEmit`
Expected: schema valid, migrasi `20261112000000_field_payments` terpasang, client tergenerate, tsc bersih. (Jika Prisma terkunci karena backend berjalan atau DB tidak terjangkau: berhenti, laporkan BLOCKED.)

```bash
git add prisma/schema.prisma prisma/migrations/20261112000000_field_payments
git commit -m "feat(pembayaran): tabel field_payments, alasan belum bayar, jenis WA tanda_terima"
```

---

### Task 2: Konstanta, teks Tanda Terima, dan `kind` di WhatsappService

**Files:**
- Create: `src/field-payments/field-payment.constants.ts`
- Create: `src/field-payments/receipt-message.util.ts`
- Create: `src/field-payments/receipt-message.util.spec.ts`
- Modify: `src/whatsapp/whatsapp.service.ts` (`sendInvoiceMessage`)

- [ ] **Step 1: Konstanta**

Buat `src/field-payments/field-payment.constants.ts`:

```ts
// Metode bayar yang boleh dicatat teknisi (sama dengan RecordPaymentDto kasir).
export const FIELD_PAYMENT_METHODS = ['tunai', 'transfer', 'qris', 'ewallet', 'debit'] as const;
export type FieldPaymentMethod = (typeof FIELD_PAYMENT_METHODS)[number];

export const METHOD_LABEL: Record<FieldPaymentMethod, string> = {
  tunai: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
  ewallet: 'E-Wallet',
  debit: 'Debit',
};

// Tunai: uang dibawa pulang teknisi. Non-tunai: tidak ada uang yang dibawa, admin mencocokkan dengan mutasi/notifikasi toko.
export const STATUS_HELD = 'dipegang_teknisi';
export const STATUS_AWAITING_MATCH = 'menunggu_cocok';
export const STATUS_VERIFIED = 'diverifikasi';
export const STATUS_REJECTED = 'ditolak';

/** Pembayaran yang uangnya masih di teknisi / belum dicocokkan admin: dihitung sebagai "sudah tertagih" saat membatasi sisa. */
export const ACTIVE_FIELD_PAYMENT_STATUSES = [STATUS_HELD, STATUS_AWAITING_MATCH] as const;
```

- [ ] **Step 2: Tulis tes teks yang gagal**

Buat `src/field-payments/receipt-message.util.spec.ts`:

```ts
import { buildReceiptMessage } from './receipt-message.util';

describe('buildReceiptMessage — Tanda Terima WA', () => {
  const base = {
    receiptNumber: 'TT-20261107-0012',
    amount: 150000,
    method: 'tunai' as const,
    customerName: 'Bu Sari',
    serviceSummary: 'Cuci AC (2)',
    paidAt: new Date('2026-11-07T03:00:00Z'),
    technicianName: 'Budi',
  };

  it('pendek: empat baris, tanpa tautan', () => {
    expect(buildReceiptMessage(base)).toBe(
      [
        'Tanda Terima TT-20261107-0012',
        'AYUB AC menerima Rp 150.000 (Tunai) dari Bu Sari',
        'untuk Cuci AC (2), 7 Nov 2026. Teknisi: Budi.',
        'Faktur menyusul dari admin.',
      ].join('\n'),
    );
  });

  it('metode non-tunai memakai labelnya', () => {
    expect(buildReceiptMessage({ ...base, method: 'qris' })).toContain('(QRIS)');
  });

  it('tanggal memakai zona WIB (UTC 18:30 = hari berikutnya di WIB)', () => {
    expect(buildReceiptMessage({ ...base, paidAt: new Date('2026-11-07T18:30:00Z') })).toContain('8 Nov 2026');
  });
});
```

Run: `npx jest src/field-payments/receipt-message.util.spec.ts`
Expected: FAIL ("Cannot find module './receipt-message.util'").

- [ ] **Step 3: Implementasi teks**

Buat `src/field-payments/receipt-message.util.ts`:

```ts
import { METHOD_LABEL, type FieldPaymentMethod } from './field-payment.constants';

const dateWib = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Tanda Terima yang dikirim teknisi ke pelanggan (WA nomor toko). SENGAJA singkat dan tanpa tautan: ini bukti uang sudah
 * diterima di lokasi, BUKAN faktur. Faktur resmi (bertautan struk) dikirim admin kemudian.
 */
export function buildReceiptMessage(p: {
  receiptNumber: string;
  amount: number;
  method: FieldPaymentMethod;
  customerName: string;
  serviceSummary: string;
  paidAt: Date;
  technicianName: string;
}): string {
  const rp = `Rp ${Math.round(p.amount).toLocaleString('id-ID')}`;
  return [
    `Tanda Terima ${p.receiptNumber}`,
    `AYUB AC menerima ${rp} (${METHOD_LABEL[p.method] ?? p.method}) dari ${p.customerName}`,
    `untuk ${p.serviceSummary}, ${dateWib.format(p.paidAt)}. Teknisi: ${p.technicianName}.`,
    'Faktur menyusul dari admin.',
  ].join('\n');
}
```

Run: `npx jest src/field-payments/receipt-message.util.spec.ts`
Expected: PASS. (Jika format bulan berbeda di lingkungan, mis. "Nov" vs "Nov.", sesuaikan ekspektasi tes ke keluaran `Intl` sebenarnya dan laporkan.)

- [ ] **Step 4: `kind` di `sendInvoiceMessage`**

Di `src/whatsapp/whatsapp.service.ts`, ubah `sendInvoiceMessage` agar menerima `kind` opsional. Parameter:

```ts
  async sendInvoiceMessage(params: {
    invoiceId: string;
    memberId?: string | null;
    phone: string;
    message: string;
    actorId: string;
    // Bawaan 'invoice'. Tanda Terima pembayaran lapangan memakai 'tanda_terima' (nomor toko yang sama, tanpa dedupe).
    kind?: WhatsappMessageKind;
  }) {
```

dan pada `whatsappLog.create` ganti `kind: WhatsappMessageKind.invoice,` menjadi `kind: params.kind ?? WhatsappMessageKind.invoice,`. Tambahkan komentar singkat bahwa pesan ini dikirim atas aksi manual pengguna sehingga tidak tunduk pada opt-out (sama dengan invoice).

- [ ] **Step 5: Verifikasi dan commit**

Run: `npx tsc --noEmit && npx jest src/field-payments src/whatsapp src/invoices`
Expected: tsc bersih, PASS.

```bash
git add src/field-payments src/whatsapp
git commit -m "feat(pembayaran): teks Tanda Terima singkat dan jenis pesan tanda_terima di WhatsappService"
```

---

### Task 3: Mencatat pembayaran lapangan (`record`)

**Files:**
- Create: `src/field-payments/dto/create-field-payment.dto.ts`
- Create: `src/field-payments/field-payments.service.ts`
- Test: `src/field-payments/field-payments.service.spec.ts`

- [ ] **Step 1: DTO**

Buat `src/field-payments/dto/create-field-payment.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { FIELD_PAYMENT_METHODS, type FieldPaymentMethod } from '../field-payment.constants';

/** Body multipart `POST /technician-jobs/:jobId/field-payments` (field file bernama `proof`). */
export class CreateFieldPaymentDto {
  @IsIn(FIELD_PAYMENT_METHODS, { message: 'Metode bayar tidak valid' }) method: FieldPaymentMethod;
  // multipart mengirim string -> diubah ke angka.
  @Type(() => Number) @IsInt({ message: 'Nominal harus bilangan bulat rupiah' }) @Min(1, { message: 'Nominal minimal Rp 1' }) amount: number;
  // Wajib bila nominal < sisa tagihan (DP/sebagian); dicek di service.
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  // Kunci idempotensi dari klien (HP bisa mengirim ulang request yang sama): pembayaran yang sama tidak tercatat dua kali.
  @IsOptional() @IsString() @MaxLength(80) clientRef?: string;
}
```

- [ ] **Step 2: Tulis tes yang gagal**

Buat `src/field-payments/field-payments.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FieldPaymentsService } from './field-payments.service';

// @nestjs/schedule ESM-only; terseret lewat modul lain. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

function setup(over: {
  job?: Record<string, unknown>;
  order?: Record<string, unknown>;
  invoice?: Record<string, unknown>;
  assignee?: boolean;
  pendingReq?: number;
  unusedReq?: number;
  activeSum?: number | null;
  dup?: Record<string, unknown> | null;
} = {}) {
  const job = { id: 'j1', orderId: 'o1', type: 'cuci', status: 'sedang_dikerjakan', complaintOfJobId: null, ...over.job };
  const order = { paymentMode: 'bayar_di_lokasi', invoiceId: 'inv1', ...over.order };
  const invoice = { id: 'inv1', grand_total: '150000', total_paid: '0', status: 'belum_dibayar', ...over.invoice };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => [invoice]),
    technicianJobAssignee: { count: jest.fn(async () => (over.assignee === false ? 0 : 1)) },
    technicianJob: { findUnique: jest.fn(async () => job), findMany: jest.fn(async () => [{ id: 'j1' }]) },
    serviceOrder: { findUnique: jest.fn(async () => order) },
    materialRequest: {
      count: jest.fn(async ({ where }: any) => (where.status === 'pending' ? (over.pendingReq ?? 0) : (over.unusedReq ?? 0))),
    },
    fieldPayment: {
      findUnique: jest.fn(async () => over.dup ?? null),
      aggregate: jest.fn(async () => ({ _sum: { amount: over.activeSum ?? null } })),
      create: jest.fn(async ({ data }: any) => ({ id: 'fp1', ...data })),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const counters: any = { dateKey: jest.fn(() => '20261107'), nextSeq: jest.fn(async () => 12) };
  const svc = new FieldPaymentsService(prisma, counters, {} as any);
  return { svc, tx, counters };
}

const proof = '/uploads/payment-proofs/abc.jpg';
const lunas = { method: 'tunai' as const, amount: 150000 };

describe('FieldPaymentsService.record — mencatat pembayaran di lokasi', () => {
  it('tunai: status dipegang_teknisi, nomor Tanda Terima dari counter, bukti + audit tersimpan; invoice TIDAK disentuh', async () => {
    const { svc, tx, counters } = setup();
    const r = await svc.record('j1', lunas, proof, 't1');
    expect(counters.nextSeq).toHaveBeenCalledWith(tx, 'tanda_terima_20261107');
    expect(tx.fieldPayment.create).toHaveBeenCalledWith({
      data: {
        invoiceId: 'inv1', orderId: 'o1', recordedById: 't1', method: 'tunai', amount: 150000, note: null,
        proofUrl: proof, status: 'dipegang_teknisi', receiptNumber: 'TT-20261107-0012', clientRef: null,
      },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorUid: 't1', action: 'field_payment.create' });
    expect(r.duplicate).toBe(false);
    expect(r.payment).toMatchObject({ id: 'fp1', status: 'dipegang_teknisi' });
  });

  it.each(['transfer', 'qris', 'ewallet', 'debit'] as const)('%s: status menunggu_cocok (tidak ada uang yang dibawa pulang)', async (method) => {
    const { svc, tx } = setup();
    await svc.record('j1', { method, amount: 150000 }, proof, 't1');
    expect(tx.fieldPayment.create.mock.calls[0][0].data).toMatchObject({ status: 'menunggu_cocok' });
  });

  it('bayar sebagian wajib catatan; dengan catatan lolos', async () => {
    const a = setup();
    await expect(a.svc.record('j1', { method: 'tunai', amount: 50000 }, proof, 't1')).rejects.toThrow('sebagian');
    const b = setup();
    await b.svc.record('j1', { method: 'tunai', amount: 50000, note: ' DP, sisa besok ' }, proof, 't1');
    expect(b.tx.fieldPayment.create.mock.calls[0][0].data).toMatchObject({ amount: 50000, note: 'DP, sisa besok' });
  });

  it('sisa tagihan memperhitungkan pembayaran lapangan yang masih aktif', async () => {
    const { svc } = setup({ activeSum: 100000 });
    await expect(svc.record('j1', { method: 'tunai', amount: 60000, note: 'sisa' }, proof, 't1')).rejects.toThrow('Melebihi sisa tagihan');
    const ok = setup({ activeSum: 100000 });
    await expect(ok.svc.record('j1', { method: 'tunai', amount: 50000 }, proof, 't1')).resolves.toMatchObject({ duplicate: false });
  });

  it('tagihan sudah penuh (termasuk yang menunggu setoran): ditolak', async () => {
    const { svc } = setup({ activeSum: 150000 });
    await expect(svc.record('j1', { method: 'tunai', amount: 1000, note: 'x' }, proof, 't1')).rejects.toThrow('terbayar penuh');
  });

  it('clientRef yang sama dari perekam yang sama: mengembalikan catatan lama (idempoten), tidak membuat baru', async () => {
    const dup = { id: 'fp0', recordedById: 't1', clientRef: 'abc' };
    const { svc, tx } = setup({ dup });
    const r = await svc.record('j1', { ...lunas, clientRef: 'abc' }, proof, 't1');
    expect(r).toEqual({ payment: dup, duplicate: true });
    expect(tx.fieldPayment.create).not.toHaveBeenCalled();
  });

  it('clientRef milik perekam lain: ditolak', async () => {
    const { svc } = setup({ dup: { id: 'fp0', recordedById: 'tX', clientRef: 'abc' } });
    await expect(svc.record('j1', { ...lunas, clientRef: 'abc' }, proof, 't1')).rejects.toThrow('clientRef');
  });

  const tolak: [string, Parameters<typeof setup>[0], string][] = [
    ['job pemasangan', { job: { type: 'pemasangan' } }, 'kasir'],
    ['job komplain', { job: { complaintOfJobId: 'j0' } }, 'komplain'],
    ['job belum dimulai', { job: { status: 'assigned' } }, 'Sedang Dikerjakan'],
    ['job sudah diajukan', { job: { status: 'menunggu_review' } }, 'Sedang Dikerjakan'],
    ['order ditagih admin', { order: { paymentMode: 'ditagih_admin' } }, 'ditagih admin'],
    ['harga belum ditetapkan', { order: { invoiceId: null } }, 'belum ditetapkan'],
    ['pengajuan sparepart masih pending', { pendingReq: 1 }, 'belum diputuskan'],
    ['sparepart disetujui belum dilaporkan terpakai', { unusedReq: 1 }, 'tandai dipakai'],
    ['invoice sudah batal', { invoice: { status: 'batal' } }, 'batal'],
  ];
  it.each(tolak)('ditolak 400: %s (tidak ada yang ditulis)', async (_nama, over, pesan) => {
    const { svc, tx } = setup(over);
    await expect(svc.record('j1', lunas, proof, 't1')).rejects.toThrow(BadRequestException);
    await expect(svc.record('j1', lunas, proof, 't1')).rejects.toThrow(pesan);
    expect(tx.fieldPayment.create).not.toHaveBeenCalled();
  });

  it('bukan assignee job: 403', async () => {
    const { svc, tx } = setup({ assignee: false });
    await expect(svc.record('j1', lunas, proof, 't9')).rejects.toThrow(ForbiddenException);
    expect(tx.fieldPayment.create).not.toHaveBeenCalled();
  });
});
```

Run: `npx jest src/field-payments/field-payments.service.spec.ts`
Expected: FAIL ("Cannot find module './field-payments.service'").

- [ ] **Step 3: Implementasi service (bagian `gateReason` + `record`)**

Buat `src/field-payments/field-payments.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TechnicianJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { isJobAssignee } from '../technician-jobs/job-assignees';
import { CreateFieldPaymentDto } from './dto/create-field-payment.dto';
import { ACTIVE_FIELD_PAYMENT_STATUSES, STATUS_AWAITING_MATCH, STATUS_HELD } from './field-payment.constants';

type Db = Prisma.TransactionClient;
interface JobGateRef {
  id: string;
  orderId: string;
  type: string;
  status: string;
  complaintOfJobId: string | null;
}

/**
 * Alasan pembayaran lapangan BELUM boleh dicatat untuk job ini (reason = null → boleh), plus id invoice order.
 * Satu fungsi dipakai `record` (menolak) dan ringkasan layar teknisi (menjelaskan kenapa tombol tertutup).
 * Gerbang sparepart: total tagihan harus sudah final sebelum menagih (lapor terpakai bisa menurunkan total).
 */
export async function gateReason(db: Db, job: JobGateRef): Promise<{ reason: string | null; invoiceId: string | null }> {
  if (job.type === 'pemasangan') return { reason: 'Pemasangan dibayar lewat kasir, bukan dicatat teknisi', invoiceId: null };
  if (job.complaintOfJobId) return { reason: 'Job komplain tidak ditagih', invoiceId: null };
  if (job.status !== TechnicianJobStatus.sedang_dikerjakan) {
    return { reason: 'Pembayaran hanya bisa dicatat saat job Sedang Dikerjakan', invoiceId: null };
  }
  const order = await db.serviceOrder.findUnique({ where: { id: job.orderId }, select: { paymentMode: true, invoiceId: true } });
  if (!order) return { reason: 'Order tidak ditemukan', invoiceId: null };
  if (order.paymentMode !== 'bayar_di_lokasi') {
    return { reason: 'Order ini ditagih admin, pembayaran tidak dicatat teknisi', invoiceId: order.invoiceId };
  }
  if (!order.invoiceId) return { reason: 'Harga jasa belum ditetapkan admin, belum bisa menagih', invoiceId: null };
  const jobs = await db.technicianJob.findMany({ where: { orderId: job.orderId }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  const pending = await db.materialRequest.count({ where: { jobId: { in: jobIds }, status: 'pending' } });
  if (pending > 0) {
    return { reason: 'Masih ada pengajuan sparepart yang belum diputuskan admin. Tunggu keputusannya dulu sebelum menagih', invoiceId: order.invoiceId };
  }
  const unused = await db.materialRequest.count({ where: { jobId: { in: jobIds }, status: 'approved', usedAt: null } });
  if (unused > 0) {
    return { reason: 'Laporkan pemakaian sparepart yang disetujui (tandai dipakai) dulu sebelum menagih', invoiceId: order.invoiceId };
  }
  return { reason: null, invoiceId: order.invoiceId };
}

@Injectable()
export class FieldPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /**
   * Teknisi (assignee) mencatat pembayaran yang ia terima di lokasi. TIDAK mengubah invoice (total_paid/status): baru
   * dihitung setelah admin memverifikasi (rencana setoran). Nominal dibatasi sisa tagihan dikurangi pembayaran lapangan
   * yang masih aktif; pembayaran sebagian wajib dicatat. Idempoten lewat `clientRef`.
   */
  async record(jobId: string, dto: CreateFieldPaymentDto, proofUrl: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.clientRef) {
        const dup = await tx.fieldPayment.findUnique({ where: { clientRef: dto.clientRef } });
        if (dup) {
          if (dup.recordedById !== actorId) throw new BadRequestException('clientRef sudah dipakai');
          return { payment: dup, duplicate: true };
        }
      }
      const job = await tx.technicianJob.findUnique({
        where: { id: jobId },
        select: { id: true, orderId: true, type: true, status: true, complaintOfJobId: true },
      });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      if (!(await isJobAssignee(tx, jobId, actorId))) throw new ForbiddenException('Job ini bukan milik Anda');

      // Kunci order dulu (urutan sama dengan setWithin/cancel): dua teknisi satu order tidak menagih bersamaan.
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${job.orderId} FOR UPDATE`;
      const gate = await gateReason(tx, job);
      if (gate.reason || !gate.invoiceId) throw new BadRequestException(gate.reason ?? 'Harga jasa belum ditetapkan admin');
      const invoiceId = gate.invoiceId;

      const rows = await tx.$queryRaw<{ id: string; grand_total: string; total_paid: string; status: string }[]>`
        SELECT id, grand_total, total_paid, status FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
      const inv = rows[0];
      if (!inv) throw new NotFoundException('Invoice tidak ditemukan');
      if (inv.status === 'batal' || inv.status === 'refund') throw new BadRequestException('Invoice sudah batal/refund');

      const active = await tx.fieldPayment.aggregate({
        where: { invoiceId, status: { in: [...ACTIVE_FIELD_PAYMENT_STATUSES] } },
        _sum: { amount: true },
      });
      const remaining = Number(inv.grand_total) - Number(inv.total_paid) - Number(active._sum.amount ?? 0);
      if (remaining <= 0) throw new BadRequestException('Tagihan sudah terbayar penuh (termasuk yang menunggu setoran)');
      if (dto.amount > remaining) {
        throw new BadRequestException(`Melebihi sisa tagihan (sisa Rp ${remaining.toLocaleString('id-ID')})`);
      }
      const note = dto.note?.trim() || null;
      if (dto.amount < remaining && (!note || note.length < 3)) {
        throw new BadRequestException('Pembayaran sebagian wajib diberi catatan (mis. DP, sisanya dibayar kapan)');
      }

      const dateKey = this.counters.dateKey(new Date());
      const seq = await this.counters.nextSeq(tx, `tanda_terima_${dateKey}`);
      const receiptNumber = `TT-${dateKey}-${String(seq).padStart(4, '0')}`;
      const payment = await tx.fieldPayment.create({
        data: {
          invoiceId,
          orderId: job.orderId,
          recordedById: actorId,
          method: dto.method,
          amount: dto.amount,
          note,
          proofUrl,
          // Tunai: uang dibawa teknisi. Non-tunai: tidak ada uang dibawa; admin mencocokkan dengan mutasi/notifikasi toko.
          status: dto.method === 'tunai' ? STATUS_HELD : STATUS_AWAITING_MATCH,
          receiptNumber,
          clientRef: dto.clientRef ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'field_payment.create',
          target: payment.id,
          detail: { jobId, orderId: job.orderId, invoiceId, method: dto.method, amount: dto.amount, receiptNumber },
        },
      });
      return { payment, duplicate: false };
    });
  }
}
```

Catatan untuk implementer: bila `tsc` mengeluh soal `Prisma.TransactionClient` vs `PrismaService` pada pemanggilan `gateReason` dari kode non-transaksi (Task 4), `PrismaService` sudah dipakai sebagai `Prisma.TransactionClient` di tempat lain (mis. `resolveOwnerId(this.prisma, …)`), jadi seharusnya aman.

- [ ] **Step 4: Jalankan tes sampai lulus**

Run: `npx tsc --noEmit && npx jest src/field-payments`
Expected: tsc bersih, PASS. (`CountersService` dan `WhatsappService` belum perlu terdaftar di modul untuk tes unit; Task 5 membuat modulnya.)

- [ ] **Step 5: Commit**

```bash
git add src/field-payments
git commit -m "feat(pembayaran): teknisi mencatat pembayaran di lokasi (gerbang sparepart final, batas sisa tagihan, idempoten)"
```

---

### Task 4: Kirim Tanda Terima, ringkasan, dan daftar milik teknisi

**Files:**
- Create: `src/field-payments/dto/send-receipt.dto.ts`
- Modify: `src/field-payments/field-payments.service.ts`
- Test: `src/field-payments/field-payments.send-receipt.spec.ts`

- [ ] **Step 1: DTO**

Buat `src/field-payments/dto/send-receipt.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendReceiptDto {
  // 'wa' (bawaan): kirim lewat nomor toko. 'kertas': teknisi memakai laporan kertas (tanpa sinyal / pelanggan tanpa HP).
  @IsOptional() @IsIn(['wa', 'kertas']) channel?: 'wa' | 'kertas';
  // Nomor/keterangan lembar laporan kertas (opsional), untuk dicocokkan admin.
  @IsOptional() @IsString() @MaxLength(80) paperReportNo?: string;
}
```

- [ ] **Step 2: Tulis tes yang gagal**

Buat `src/field-payments/field-payments.send-receipt.spec.ts`:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FieldPaymentsService } from './field-payments.service';

jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

function setup(over: { fp?: Record<string, unknown>; waStatus?: string; waError?: string | null; customerPhone?: string | null; memberPhone?: string | null } = {}) {
  const fp = {
    id: 'fp1', invoiceId: 'inv1', orderId: 'o1', recordedById: 't1', method: 'tunai', amount: 150000,
    status: 'dipegang_teknisi', receiptNumber: 'TT-20261107-0012', createdAt: new Date('2026-11-07T03:00:00Z'),
    invoice: {
      id: 'inv1', memberId: 'm1', customerName: 'Bu Sari',
      customerPhone: over.customerPhone === undefined ? '0812-3456-7890' : over.customerPhone,
      member: { name: 'Bu Sari', phone: over.memberPhone ?? null },
    },
    recordedBy: { displayName: 'Budi' },
    ...over.fp,
  };
  const prisma: any = {
    fieldPayment: {
      findUnique: jest.fn(async () => fp),
      update: jest.fn(async ({ data }: any) => ({ ...fp, ...data })),
    },
    invoiceItem: { findMany: jest.fn(async () => [{ name: 'Cuci AC', qty: 2 }]) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const whatsapp: any = {
    sendInvoiceMessage: jest.fn(async () => ({ id: 'log1', status: over.waStatus ?? 'terkirim', error: over.waError ?? null })),
  };
  const svc = new FieldPaymentsService(prisma, {} as any, whatsapp);
  return { svc, prisma, whatsapp };
}

describe('FieldPaymentsService.sendReceipt', () => {
  it('WA terkirim: pesan pendek lewat nomor toko (kind tanda_terima), saluran wa + waktu kirim tersimpan', async () => {
    const { svc, prisma, whatsapp } = setup();
    const r = await svc.sendReceipt('fp1', {}, 't1', 'teknisi');
    const args = whatsapp.sendInvoiceMessage.mock.calls[0][0];
    expect(args).toMatchObject({ invoiceId: 'inv1', memberId: 'm1', phone: '0812-3456-7890', actorId: 't1', kind: 'tanda_terima' });
    expect(args.message).toContain('TT-20261107-0012');
    expect(args.message).toContain('Rp 150.000 (Tunai)');
    expect(args.message).toContain('Cuci AC (2)');
    expect(args.message).toContain('Teknisi: Budi');
    const upd = prisma.fieldPayment.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'fp1' });
    expect(upd.data).toMatchObject({ receiptChannel: 'wa', receiptWaLogId: 'log1' });
    expect(upd.data.receiptSentAt).toBeInstanceOf(Date);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'field_payment.receipt_sent', target: 'fp1' });
    expect(r).toMatchObject({ sent: true, channel: 'wa' });
  });

  it('nomor HP diambil dari member bila invoice tidak punya', async () => {
    const { svc, whatsapp } = setup({ customerPhone: null, memberPhone: '081200000000' });
    await svc.sendReceipt('fp1', {}, 't1', 'teknisi');
    expect(whatsapp.sendInvoiceMessage.mock.calls[0][0].phone).toBe('081200000000');
  });

  it('Fonnte gagal: tidak ditandai terkirim, hasil sent:false + alasan (teknisi bisa kirim ulang atau pakai kertas)', async () => {
    const { svc, prisma } = setup({ waStatus: 'gagal', waError: 'device disconnect' });
    const r = await svc.sendReceipt('fp1', {}, 't1', 'teknisi');
    expect(r).toMatchObject({ sent: false, error: 'device disconnect' });
    expect(prisma.fieldPayment.update.mock.calls[0][0].data).not.toHaveProperty('receiptSentAt');
    expect(prisma.fieldPayment.update.mock.calls[0][0].data).toMatchObject({ receiptWaLogId: 'log1' });
  });

  it('pelanggan tanpa nomor HP valid: 400 dan tidak mengirim', async () => {
    const { svc, whatsapp } = setup({ customerPhone: '-', memberPhone: null });
    await expect(svc.sendReceipt('fp1', {}, 't1', 'teknisi')).rejects.toThrow('kertas');
    expect(whatsapp.sendInvoiceMessage).not.toHaveBeenCalled();
  });

  it('channel kertas: ditandai kertas + nomor lembar, tanpa WA', async () => {
    const { svc, prisma, whatsapp } = setup();
    const r = await svc.sendReceipt('fp1', { channel: 'kertas', paperReportNo: ' LP-0099 ' }, 't1', 'teknisi');
    expect(whatsapp.sendInvoiceMessage).not.toHaveBeenCalled();
    expect(prisma.fieldPayment.update.mock.calls[0][0].data).toEqual({ receiptChannel: 'kertas', paperReportNo: 'LP-0099' });
    expect(r).toMatchObject({ sent: false, channel: 'kertas' });
  });

  it('bukan perekam: 403 (admin boleh)', async () => {
    await expect(setup().svc.sendReceipt('fp1', {}, 't9', 'teknisi')).rejects.toThrow(ForbiddenException);
    await expect(setup().svc.sendReceipt('fp1', {}, 'a1', 'admin')).resolves.toMatchObject({ sent: true });
  });

  it('pembayaran yang sudah ditolak admin: 400', async () => {
    await expect(setup({ fp: { status: 'ditolak' } }).svc.sendReceipt('fp1', {}, 't1', 'teknisi')).rejects.toThrow(BadRequestException);
  });
});
```

Run: `npx jest src/field-payments/field-payments.send-receipt.spec.ts`
Expected: FAIL (`sendReceipt` belum ada).

- [ ] **Step 3: Implementasi `sendReceipt`, `listForJob`, `mine`**

Di `field-payments.service.ts` tambahkan impor:

```ts
import { WhatsappMessageKind } from '@prisma/client';
import { waPhone } from '../whatsapp/wa-format.util';
import { SendReceiptDto } from './dto/send-receipt.dto';
import { buildReceiptMessage } from './receipt-message.util';
import { STATUS_REJECTED, type FieldPaymentMethod } from './field-payment.constants';
```

(gabungkan dengan impor yang sudah ada dari modul yang sama; jangan duplikasi). Tambahkan method di dalam kelas, sesudah `record`:

```ts
  /**
   * Kirim Tanda Terima ke pelanggan lewat nomor toko (WA), atau tandai pakai laporan kertas. Hanya perekam (atau admin).
   * Gagal kirim WA tidak melempar: hasil `sent:false` + alasan, teknisi boleh kirim ulang atau pilih kertas.
   */
  async sendReceipt(paymentId: string, dto: SendReceiptDto, actorId: string, role: string) {
    const fp = await this.prisma.fieldPayment.findUnique({
      where: { id: paymentId },
      include: { invoice: { include: { member: true } }, recordedBy: { select: { displayName: true } } },
    });
    if (!fp) throw new NotFoundException('Pembayaran tidak ditemukan');
    if (role !== 'admin' && fp.recordedById !== actorId) throw new ForbiddenException('Pembayaran ini bukan catatan Anda');
    if (fp.status === STATUS_REJECTED) throw new BadRequestException('Pembayaran ini sudah ditolak admin');

    if (dto.channel === 'kertas') {
      const paperReportNo = dto.paperReportNo?.trim() || null;
      await this.prisma.fieldPayment.update({ where: { id: paymentId }, data: { receiptChannel: 'kertas', paperReportNo } });
      await this.prisma.auditLog.create({
        data: { actorUid: actorId, action: 'field_payment.receipt_sent', target: paymentId, detail: { channel: 'kertas', paperReportNo } },
      });
      return { sent: false, channel: 'kertas' as const, receiptNumber: fp.receiptNumber };
    }

    const rawPhone = fp.invoice.customerPhone || fp.invoice.member?.phone || '';
    if (!waPhone(rawPhone)) {
      throw new BadRequestException('Nomor HP pelanggan belum ada atau tidak valid. Pakai laporan kertas sebagai bukti.');
    }
    const items = await this.prisma.invoiceItem.findMany({
      where: { invoiceId: fp.invoiceId, kind: 'service' },
      select: { name: true, qty: true },
    });
    const names = [...new Set(items.map((i) => (Number(i.qty) > 1 ? `${i.name} (${Number(i.qty)})` : i.name)))];
    const serviceSummary = names.length > 0 ? names.slice(0, 3).join(', ') + (names.length > 3 ? ', dll.' : '') : 'servis AC';
    const message = buildReceiptMessage({
      receiptNumber: fp.receiptNumber,
      amount: Number(fp.amount),
      method: fp.method as FieldPaymentMethod,
      customerName: fp.invoice.customerName || fp.invoice.member?.name || 'Pelanggan',
      serviceSummary,
      paidAt: fp.createdAt,
      technicianName: fp.recordedBy.displayName,
    });
    const log = await this.whatsapp.sendInvoiceMessage({
      invoiceId: fp.invoiceId,
      memberId: fp.invoice.memberId,
      phone: rawPhone,
      message,
      actorId,
      kind: WhatsappMessageKind.tanda_terima,
    });
    const sent = log.status === 'terkirim';
    await this.prisma.fieldPayment.update({
      where: { id: paymentId },
      data: { receiptWaLogId: log.id, ...(sent ? { receiptChannel: 'wa', receiptSentAt: new Date() } : {}) },
    });
    if (sent) {
      await this.prisma.auditLog.create({
        data: { actorUid: actorId, action: 'field_payment.receipt_sent', target: paymentId, detail: { channel: 'wa', logId: log.id } },
      });
    }
    return { sent, channel: 'wa' as const, receiptNumber: fp.receiptNumber, error: sent ? null : (log.error ?? 'Gagal mengirim WhatsApp') };
  }
```

Catatan: pada tes, saluran `wa` sukses mengharapkan `update.data` memuat `receiptChannel: 'wa'` dan `receiptWaLogId`; pada gagal TIDAK memuat `receiptSentAt` (diatur kondisional di atas).

Lalu tambahkan dua method baca (untuk layar teknisi). Untuk keduanya tulis tes ringkas di spec yang sama (lihat Step 4):

```ts
  /** Ringkasan pembayaran lapangan satu order untuk layar job: daftar, sisa efektif, dan apakah/kenapa tombol Catat Pembayaran tertutup. */
  async listForJob(jobId: string, actorId: string, role: string) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      select: { id: true, orderId: true, type: true, status: true, complaintOfJobId: true },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    if (role === 'teknisi' && !(await isJobAssignee(this.prisma, jobId, actorId))) {
      throw new ForbiddenException('Job ini bukan milik Anda');
    }
    const [payments, order, gate] = await Promise.all([
      this.prisma.fieldPayment.findMany({
        where: { orderId: job.orderId },
        orderBy: { createdAt: 'asc' },
        include: { recordedBy: { select: { id: true, displayName: true } } },
      }),
      this.prisma.serviceOrder.findUnique({
        where: { id: job.orderId },
        select: {
          paymentMode: true,
          unpaidReason: true,
          invoice: { select: { id: true, number: true, status: true, grandTotal: true, totalPaid: true } },
        },
      }),
      gateReason(this.prisma, job),
    ]);
    const active = ACTIVE_FIELD_PAYMENT_STATUSES as readonly string[];
    const activeTotal = payments.filter((p) => active.includes(p.status)).reduce((s, p) => s + Number(p.amount), 0);
    const remaining = order?.invoice ? Number(order.invoice.grandTotal) - Number(order.invoice.totalPaid) - activeTotal : null;
    const blockedReason = gate.reason ?? (remaining !== null && remaining <= 0 ? 'Tagihan sudah terbayar penuh' : null);
    return {
      paymentMode: order?.paymentMode ?? null,
      unpaidReason: order?.unpaidReason ?? null,
      invoice: order?.invoice
        ? { ...order.invoice, grandTotal: Number(order.invoice.grandTotal), totalPaid: Number(order.invoice.totalPaid) }
        : null,
      activeTotal,
      remaining,
      canRecord: blockedReason === null,
      blockedReason,
      payments: payments.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        method: p.method,
        amount: Number(p.amount),
        note: p.note,
        status: p.status,
        proofUrl: p.proofUrl,
        receiptChannel: p.receiptChannel,
        receiptSentAt: p.receiptSentAt,
        createdAt: p.createdAt,
        recordedBy: p.recordedBy,
      })),
    };
  }

  /** Catatan pembayaran milik teknisi yang login (uang yang ia pegang = status dipegang_teknisi). */
  async mine(actorId: string, status?: string) {
    const rows = await this.prisma.fieldPayment.findMany({
      where: { recordedById: actorId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { invoice: { select: { number: true, customerName: true } } },
    });
    return {
      heldTotal: rows.filter((r) => r.status === STATUS_HELD).reduce((s, r) => s + Number(r.amount), 0),
      items: rows.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        method: r.method,
        amount: Number(r.amount),
        status: r.status,
        receiptChannel: r.receiptChannel,
        receiptSentAt: r.receiptSentAt,
        createdAt: r.createdAt,
        invoiceNumber: r.invoice.number,
        customerName: r.invoice.customerName,
      })),
    };
  }
```

- [ ] **Step 4: Tes untuk `listForJob` dan `mine`**

Tambahkan di AKHIR `field-payments.send-receipt.spec.ts`:

```ts
describe('FieldPaymentsService.listForJob / mine', () => {
  function make(over: { status?: string; payments?: any[]; paymentMode?: string; grand?: number; assignee?: boolean } = {}) {
    const job = { id: 'j1', orderId: 'o1', type: 'cuci', status: over.status ?? 'sedang_dikerjakan', complaintOfJobId: null };
    const prisma: any = {
      technicianJob: { findUnique: jest.fn(async () => job), findMany: jest.fn(async () => [{ id: 'j1' }]) },
      technicianJobAssignee: { count: jest.fn(async () => (over.assignee === false ? 0 : 1)) },
      fieldPayment: {
        findMany: jest.fn(async () =>
          over.payments ?? [
            { id: 'p1', receiptNumber: 'TT-1', method: 'tunai', amount: 100000, note: null, status: 'dipegang_teknisi', proofUrl: '/u/x.jpg',
              receiptChannel: 'wa', receiptSentAt: new Date(), createdAt: new Date(), recordedBy: { id: 't1', displayName: 'Budi' },
              invoice: { number: 'INV-1', customerName: 'Bu Sari' } },
          ],
        ),
      },
      serviceOrder: {
        findUnique: jest.fn(async () => ({
          paymentMode: over.paymentMode ?? 'bayar_di_lokasi', unpaidReason: null, invoiceId: 'inv1',
          invoice: { id: 'inv1', number: 'INV-1', status: 'belum_dibayar', grandTotal: over.grand ?? 150000, totalPaid: 0 },
        })),
      },
      materialRequest: { count: jest.fn(async () => 0) },
    };
    return { svc: new FieldPaymentsService(prisma, {} as any, {} as any), prisma };
  }

  it('listForJob: sisa efektif dikurangi pembayaran aktif; masih boleh mencatat selama ada sisa', async () => {
    const { svc } = make();
    const r = await svc.listForJob('j1', 't1', 'teknisi');
    expect(r).toMatchObject({ activeTotal: 100000, remaining: 50000, canRecord: true, blockedReason: null });
    expect(r.payments[0]).toMatchObject({ id: 'p1', amount: 100000, recordedBy: { displayName: 'Budi' } });
  });

  it('listForJob: sisa habis = tombol tertutup dengan alasan', async () => {
    const { svc } = make({ grand: 100000 });
    const r = await svc.listForJob('j1', 't1', 'teknisi');
    expect(r).toMatchObject({ remaining: 0, canRecord: false, blockedReason: 'Tagihan sudah terbayar penuh' });
  });

  it('listForJob: order ditagih admin = tertutup dengan alasan gerbang', async () => {
    const { svc } = make({ paymentMode: 'ditagih_admin' });
    const r = await svc.listForJob('j1', 't1', 'teknisi');
    expect(r.canRecord).toBe(false);
    expect(r.blockedReason).toContain('ditagih admin');
  });

  it('listForJob: teknisi bukan assignee ditolak; admin tidak dicek', async () => {
    await expect(make({ assignee: false }).svc.listForJob('j1', 't9', 'teknisi')).rejects.toThrow(ForbiddenException);
    await expect(make({ assignee: false }).svc.listForJob('j1', 'a1', 'admin')).resolves.toBeDefined();
  });

  it('mine: menjumlah uang yang masih dipegang', async () => {
    const { svc, prisma } = make();
    const r = await svc.mine('t1');
    expect(prisma.fieldPayment.findMany.mock.calls[0][0].where).toEqual({ recordedById: 't1' });
    expect(r.heldTotal).toBe(100000);
    expect(r.items[0]).toMatchObject({ invoiceNumber: 'INV-1', customerName: 'Bu Sari' });
  });

  it('mine: filter status', async () => {
    const { svc, prisma } = make();
    await svc.mine('t1', 'dipegang_teknisi');
    expect(prisma.fieldPayment.findMany.mock.calls[0][0].where).toEqual({ recordedById: 't1', status: 'dipegang_teknisi' });
  });
});
```

- [ ] **Step 5: Jalankan tes sampai lulus dan commit**

Run: `npx tsc --noEmit && npx jest src/field-payments`
Expected: tsc bersih, PASS.

```bash
git add src/field-payments
git commit -m "feat(pembayaran): kirim Tanda Terima WA / tandai kertas, ringkasan pembayaran job, dan daftar uang dipegang teknisi"
```

---

### Task 5: Controller + modul

**Files:**
- Create: `src/field-payments/field-payments.controller.ts`, `src/field-payments/field-payments.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/field-payments/field-payments.controller.spec.ts`

- [ ] **Step 1: Tulis tes yang gagal**

Buat `src/field-payments/field-payments.controller.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { FieldPaymentsController } from './field-payments.controller';

jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

function make() {
  const payment = { id: 'fp1', receiptNumber: 'TT-20261107-0012', method: 'tunai', amount: 150000, status: 'dipegang_teknisi' };
  const service: any = {
    record: jest.fn(async () => ({ payment, duplicate: false })),
    sendReceipt: jest.fn(async () => ({ sent: true, channel: 'wa' })),
    listForJob: jest.fn(async () => ({ payments: [] })),
    mine: jest.fn(async () => ({ heldTotal: 0, items: [] })),
  };
  const realtime: any = { emitToAdmin: jest.fn() };
  const notifications: any = { notifyRoles: jest.fn(async () => undefined) };
  const prisma: any = { technicianJob: { findUnique: jest.fn(async () => ({ member: { name: 'Bu Sari' }, technician: { displayName: 'Budi' } })) } };
  return { ctrl: new FieldPaymentsController(service, realtime, notifications, prisma), service, realtime, notifications };
}

const user = { sub: 't1', role: 'teknisi' } as any;
const file = { filename: 'abc.jpg' } as Express.Multer.File;

describe('FieldPaymentsController', () => {
  it('POST field-payments: wajib ada foto bukti', async () => {
    const { ctrl, service } = make();
    await expect(ctrl.record('j1', { method: 'tunai', amount: 150000 } as any, undefined as any, user)).rejects.toThrow(BadRequestException);
    expect(service.record).not.toHaveBeenCalled();
  });

  it('POST field-payments: simpan path bukti, kabari admin lewat realtime + notifikasi', async () => {
    const { ctrl, service, realtime, notifications } = make();
    const dto: any = { method: 'transfer', amount: 150000 };
    const r = await ctrl.record('j1', dto, file, user);
    expect(service.record).toHaveBeenCalledWith('j1', dto, '/uploads/payment-proofs/abc.jpg', 't1');
    expect(realtime.emitToAdmin).toHaveBeenCalledWith('field_payment.created', { paymentId: 'fp1', jobId: 'j1' });
    const [roles, payload] = notifications.notifyRoles.mock.calls[0];
    expect(roles).toEqual(['admin']);
    expect(payload).toMatchObject({ type: 'field_payment', target: 'fp1', title: 'Pembayaran Lapangan Dicatat' });
    expect(payload.body).toContain('Budi');
    expect(payload.body).toContain('TT-20261107-0012');
    expect(r).toMatchObject({ payment: { id: 'fp1' }, duplicate: false });
  });

  it('POST field-payments: permintaan ulang (duplikat) tidak mengabari admin lagi', async () => {
    const { ctrl, service, realtime, notifications } = make();
    service.record.mockResolvedValueOnce({ payment: { id: 'fp0' }, duplicate: true });
    await ctrl.record('j1', { method: 'tunai', amount: 1 } as any, file, user);
    expect(realtime.emitToAdmin).not.toHaveBeenCalled();
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });

  it('send-receipt, daftar job, dan mine meneruskan peminta ke service', async () => {
    const { ctrl, service } = make();
    await ctrl.sendReceipt('fp1', { channel: 'kertas' } as any, user);
    expect(service.sendReceipt).toHaveBeenCalledWith('fp1', { channel: 'kertas' }, 't1', 'teknisi');
    await ctrl.listForJob('j1', user);
    expect(service.listForJob).toHaveBeenCalledWith('j1', 't1', 'teknisi');
    await ctrl.mine('dipegang_teknisi', user);
    expect(service.mine).toHaveBeenCalledWith('t1', 'dipegang_teknisi');
  });
});
```

Run: `npx jest src/field-payments/field-payments.controller.spec.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 2: Controller**

Buat `src/field-payments/field-payments.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { photoUploadOptions } from '../common/uploads/photo-upload';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { FieldPaymentsService } from './field-payments.service';
import { CreateFieldPaymentDto } from './dto/create-field-payment.dto';
import { SendReceiptDto } from './dto/send-receipt.dto';
import { METHOD_LABEL, type FieldPaymentMethod } from './field-payment.constants';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class FieldPaymentsController {
  constructor(
    private readonly payments: FieldPaymentsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  // Teknisi mencatat pembayaran di lokasi (multipart: method, amount, note?, clientRef?, file `proof`).
  @Roles('teknisi')
  @Post('technician-jobs/:jobId/field-payments')
  @UseInterceptors(FileInterceptor('proof', photoUploadOptions('payment-proofs', 10)))
  async record(
    @Param('jobId') jobId: string,
    @Body() dto: CreateFieldPaymentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    // multer diam-diam melewati request yang bukan multipart; foto bukti wajib untuk semua metode.
    if (!file) {
      throw new BadRequestException('Foto bukti pembayaran wajib. Ambil/pilih fotonya (JPG/PNG/WEBP, maks 10MB) lalu coba lagi.');
    }
    const r = await this.payments.record(jobId, dto, `/uploads/payment-proofs/${file.filename}`, user.sub);
    if (!r.duplicate) {
      this.realtime.emitToAdmin('field_payment.created', { paymentId: r.payment.id, jobId });
      void this.notifyAdmins(jobId, r.payment).catch(() => undefined);
    }
    return r;
  }

  private async notifyAdmins(
    jobId: string,
    p: { id: string; receiptNumber: string; method: string; amount: unknown },
  ) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      select: { member: { select: { name: true } }, technician: { select: { displayName: true } } },
    });
    const rp = `Rp ${Number(p.amount).toLocaleString('id-ID')}`;
    const metode = METHOD_LABEL[p.method as FieldPaymentMethod] ?? p.method;
    const cocok = p.method === 'tunai' ? 'Uang dibawa teknisi, cocokkan saat setoran.' : 'Cocokkan dengan mutasi/notifikasi rekening toko.';
    await this.notifications.notifyRoles(['admin'], {
      title: 'Pembayaran Lapangan Dicatat',
      body: `${job?.technician?.displayName ?? 'Teknisi'} mencatat ${rp} (${metode})${job?.member ? ` dari ${job.member.name}` : ''}, ${p.receiptNumber}. ${cocok}`,
      type: 'field_payment',
      target: p.id,
    });
  }

  @Roles('admin', 'kasir', 'teknisi')
  @Get('technician-jobs/:jobId/field-payments')
  listForJob(@Param('jobId') jobId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.payments.listForJob(jobId, user.sub, user.role);
  }

  @Roles('teknisi', 'admin')
  @Post('field-payments/:id/send-receipt')
  sendReceipt(@Param('id') id: string, @Body() dto: SendReceiptDto, @CurrentUser() user: CurrentUserPayload) {
    return this.payments.sendReceipt(id, dto, user.sub, user.role);
  }

  // Uang yang saya pegang / riwayat catatan saya.
  @Roles('teknisi')
  @Get('field-payments/mine')
  mine(@Query('status') status: string | undefined, @CurrentUser() user: CurrentUserPayload) {
    return this.payments.mine(user.sub, status || undefined);
  }
}
```

- [ ] **Step 3: Modul + daftar di AppModule**

Buat `src/field-payments/field-payments.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FieldPaymentsController } from './field-payments.controller';
import { FieldPaymentsService } from './field-payments.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationsModule } from '../notifications/notifications.module';

// PrismaService, CountersService, dan RealtimeGateway disediakan global (lihat modul masing-masing). Bila Nest melaporkan
// provider tidak ditemukan saat boot, impor modul pemiliknya di sini.
@Module({
  imports: [WhatsappModule, NotificationsModule],
  controllers: [FieldPaymentsController],
  providers: [FieldPaymentsService],
  exports: [FieldPaymentsService],
})
export class FieldPaymentsModule {}
```

Di `src/app.module.ts` impor `FieldPaymentsModule` dan tambahkan ke `imports` (ikuti pola modul lain, mis. letakkan dekat `PaymentsModule`).

- [ ] **Step 4: Verifikasi dan commit**

Run: `npx tsc --noEmit && npx jest src/field-payments && npm run build`
Expected: tsc bersih, PASS, build sukses. Untuk memastikan DI Nest tidak error tanpa menyalakan DB, buat spec SEMENTARA yang meng-compile `AppModule` lewat `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({})` (cara yang dipakai pengerjaan sebelumnya), pastikan `FieldPaymentsService` ter-resolve, lalu HAPUS spec sementara itu sebelum commit.

```bash
git add src/field-payments src/app.module.ts
git commit -m "feat(pembayaran): endpoint pembayaran lapangan teknisi (catat + foto bukti, kirim Tanda Terima, ringkasan, milik saya)"
```

---

### Task 6: Penjaga di tempat lain

Tiga penjaga kecil agar Tanda Terima yang sudah beredar tidak "bocor": ganda bayar, edit jasa, dan pembatalan job.

**Files:**
- Modify: `src/payments/payments.service.ts`
- Modify: `src/technician-jobs/service-pricing.service.ts` (`techEditLines`)
- Modify: `src/technician-jobs/invoice-void.util.ts` (`assertLastJobCancelAllowed`)
- Test: `src/payments/payments.service.field.spec.ts` (buat), `src/technician-jobs/service-pricing.tech-edit.spec.ts` (ubah), `src/technician-jobs/invoice-void.util.spec.ts` (ubah)

- [ ] **Step 1: Tulis tes yang gagal (penjaga ganda bayar)**

Buat `src/payments/payments.service.field.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

// Uang yang sudah dicatat teknisi di lokasi (belum diverifikasi) tidak boleh dibayar lagi lewat kasir/admin.

function setup(activeSum: number | null) {
  const tx: any = {
    $queryRaw: jest.fn(async () => [{ id: 'inv1', grand_total: '150000', total_paid: '0', status: 'belum_dibayar' }]),
    fieldPayment: { aggregate: jest.fn(async () => ({ _sum: { amount: activeSum } })) },
    manualPayment: { create: jest.fn(async () => ({ id: 'mp1' })) },
    invoice: { update: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const shifts: any = { findOpenShiftForKasir: jest.fn(async () => null) };
  return { svc: new PaymentsService(prisma, shifts), tx };
}

describe('PaymentsService.record — penjaga pembayaran lapangan', () => {
  it('tanpa pembayaran lapangan aktif: perilaku lama', async () => {
    const { svc, tx } = setup(null);
    await expect(svc.record('inv1', { method: 'tunai', amount: 150000 }, 'k1')).resolves.toMatchObject({ status: 'lunas' });
    expect(tx.fieldPayment.aggregate.mock.calls[0][0].where).toMatchObject({
      invoiceId: 'inv1',
      status: { in: ['dipegang_teknisi', 'menunggu_cocok'] },
    });
  });

  it('sebagian sudah dicatat teknisi: nominal melebihi sisa efektif ditolak dengan penjelasan', async () => {
    const { svc, tx } = setup(100000);
    const p = svc.record('inv1', { method: 'tunai', amount: 60000 }, 'k1');
    await expect(p).rejects.toThrow(BadRequestException);
    await expect(svc.record('inv1', { method: 'tunai', amount: 60000 }, 'k1')).rejects.toThrow('menunggu setoran');
    expect(tx.manualPayment.create).not.toHaveBeenCalled();
  });

  it('nominal yang muat di sisa efektif tetap boleh', async () => {
    const { svc } = setup(100000);
    await expect(svc.record('inv1', { method: 'tunai', amount: 50000 }, 'k1')).resolves.toMatchObject({ status: 'dp' });
  });
});
```

Run: `npx jest src/payments/payments.service.field.spec.ts`
Expected: FAIL (`tx.fieldPayment.aggregate` tidak dipanggil / tidak menolak).

- [ ] **Step 2: Implementasi penjaga ganda bayar**

Di `src/payments/payments.service.ts`, tambah impor `import { ACTIVE_FIELD_PAYMENT_STATUSES } from '../field-payments/field-payment.constants';` dan ganti blok

```ts
      const grand = Number(inv.grand_total);
      const paid = Number(inv.total_paid);
      const remaining = grand - paid;
      if (dto.amount > remaining) {
        throw new BadRequestException('Melebihi sisa tagihan');
      }
```

dengan:

```ts
      const grand = Number(inv.grand_total);
      const paid = Number(inv.total_paid);
      // Uang yang sudah dicatat teknisi di lokasi (belum diverifikasi) sudah "tertagih": jangan dibayar dua kali.
      const fieldActive = await tx.fieldPayment.aggregate({
        where: { invoiceId, status: { in: [...ACTIVE_FIELD_PAYMENT_STATUSES] } },
        _sum: { amount: true },
      });
      const pendingField = Number(fieldActive._sum.amount ?? 0);
      const remaining = grand - paid;
      if (dto.amount > remaining - pendingField) {
        throw new BadRequestException(
          pendingField > 0
            ? `Melebihi sisa tagihan: Rp ${pendingField.toLocaleString('id-ID')} sudah dicatat teknisi dan menunggu setoran`
            : 'Melebihi sisa tagihan',
        );
      }
```

Run: `npx jest src/payments` lalu `npx jest` penuh. Jika ada spec lain yang memakai `PaymentsService.record` dengan tx tiruan tanpa `fieldPayment`, tambahkan `fieldPayment: { aggregate: jest.fn(async () => ({ _sum: { amount: null } })) }` ke tiruan itu.
Expected: PASS.

- [ ] **Step 3: Tes + implementasi kunci edit jasa**

Di `service-pricing.tech-edit.spec.ts` ubah `setupEdit`: tambah opsi `fieldPayments?: number` dan di `tx` tambahkan

```ts
    fieldPayment: { count: jest.fn(async () => over.fieldPayments ?? 0) },
```

Tambahkan satu kasus ke tabel `tolak`:

```ts
    ['pembayaran lapangan sudah tercatat (Tanda Terima beredar)', () => setupEdit({ fieldPayments: 1 }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'Tanda Terima'],
```

Plus tes bahwa pemeriksaan memakai filter yang benar:

```ts
  it('kunci edit: pembayaran lapangan yang ditolak admin tidak mengunci; selain itu mengunci', async () => {
    const { svc, tx } = setupEdit();
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 't1');
    expect(tx.fieldPayment.count).toHaveBeenCalledWith({ where: { orderId: 'o1', status: { not: 'ditolak' } } });
  });
```

Implementasi di `techEditLines`, tepat sesudah pemeriksaan `!owner.billingDerived || !order?.invoiceId`:

```ts
      // Tanda Terima sudah terbit (pembayaran lapangan tercatat, belum ditolak): jasa dikunci supaya nominal tidak berbeda dari
      // bukti yang dipegang pelanggan. Koreksi selanjutnya hanya oleh admin.
      const fieldPaid = await tx.fieldPayment.count({ where: { orderId: owner.orderId, status: { not: 'ditolak' } } });
      if (fieldPaid > 0) {
        throw new BadRequestException('Pembayaran sudah dicatat dan Tanda Terima sudah terbit, jasa tidak bisa disesuaikan lagi. Hubungi admin untuk koreksi.');
      }
```

Run: `npx jest src/technician-jobs/service-pricing` → PASS.

- [ ] **Step 4: Tes + implementasi penjaga pembatalan**

Di `invoice-void.util.spec.ts` ubah `fakeTx`: tambah opsi `activeFieldPayments?: number` dan properti

```ts
    fieldPayment: { count: jest.fn(async () => over.activeFieldPayments ?? 0) },
```

Tambahkan tes di `describe('assertLastJobCancelAllowed', ...)`:

```ts
  it('job terakhir + ada pembayaran lapangan aktif (uang di teknisi / menunggu dicocokkan): ditolak', async () => {
    const tx = fakeTx({ activeFieldPayments: 1 });
    await expect(assertLastJobCancelAllowed(tx, job)).rejects.toThrow('uang yang dipegang teknisi');
    expect(tx.fieldPayment.count).toHaveBeenCalledWith({
      where: { orderId: 'o1', status: { in: ['dipegang_teknisi', 'menunggu_cocok'] } },
    });
  });

  it('bukan job terakhir: pembayaran lapangan aktif tidak menghalangi', async () => {
    const tx = fakeTx({ otherActive: 1, activeFieldPayments: 1 });
    await expect(assertLastJobCancelAllowed(tx, job)).resolves.toBeUndefined();
  });
```

Implementasi di `invoice-void.util.ts` (impor `ACTIVE_FIELD_PAYMENT_STATUSES` dari `../field-payments/field-payment.constants`): di `assertLastJobCancelAllowed`, sesudah blok pemeriksaan `total_paid`, tambahkan:

```ts
  const heldPayments = await tx.fieldPayment.count({
    where: { orderId: job.orderId, status: { in: [...ACTIVE_FIELD_PAYMENT_STATUSES] } },
  });
  if (heldPayments > 0) {
    throw new BadRequestException(
      'Order ini punya pembayaran lapangan yang belum diverifikasi (uang yang dipegang teknisi / menunggu dicocokkan), jadi job terakhirnya tidak bisa dibatalkan. Selesaikan setorannya dulu.',
    );
  }
```

Run: `npx tsc --noEmit && npx jest`
Expected: tsc bersih, semua suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/payments src/technician-jobs
git commit -m "feat(pembayaran): penjaga uang lapangan: tak boleh dibayar ganda, jasa dikunci setelah Tanda Terima, job terakhir tak bisa dibatalkan"
```

---

### Task 7: Gerbang Ajukan Selesai (bayar di lokasi)

**Files:**
- Create: `src/technician-jobs/payment-gate.util.ts`
- Create: `src/technician-jobs/payment-gate.util.spec.ts`
- Modify: `src/technician-jobs/dto/submit-for-review.dto.ts`, `src/technician-jobs/technician-jobs.service.ts` (`submitForReview`, `submitJobInTx`, `submitOrderForReview`), `src/technician-jobs/technician-jobs.controller.ts` (rute submit-for-review)

- [ ] **Step 1: Tulis tes util yang gagal**

Buat `src/technician-jobs/payment-gate.util.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { assertPaymentRecordedOrExplained } from './payment-gate.util';

// Order bayar_di_lokasi: teknisi baru boleh Ajukan Selesai bila pembayaran sudah dicatat ATAU ada alasan tertulis
// (mis. pelanggan belum bisa membayar). Admin, pemasangan, komplain, order ditagih_admin, dan tagihan Rp 0 tidak dihalangi.

const job = { id: 'j1', orderId: 'o1', type: 'cuci', complaintOfJobId: null as string | null };

function fakeTx(over: { paymentMode?: string; invoiceId?: string | null; recorded?: number; grand?: number; paid?: number } = {}) {
  return {
    serviceOrder: {
      findUnique: jest.fn(async () => ({ paymentMode: over.paymentMode ?? 'bayar_di_lokasi', invoiceId: over.invoiceId === undefined ? 'inv1' : over.invoiceId })),
      update: jest.fn(async () => ({})),
    },
    fieldPayment: { count: jest.fn(async () => over.recorded ?? 0) },
    invoice: { findUnique: jest.fn(async () => ({ grandTotal: over.grand ?? 150000, totalPaid: over.paid ?? 0 })) },
  } as any;
}

describe('assertPaymentRecordedOrExplained', () => {
  it('belum ada pembayaran dan tanpa alasan: ditolak', async () => {
    await expect(assertPaymentRecordedOrExplained(fakeTx(), job, 'teknisi')).rejects.toThrow(BadRequestException);
    await expect(assertPaymentRecordedOrExplained(fakeTx(), job, 'teknisi', '  ab ')).rejects.toThrow('catat pembayaran dulu');
  });

  it('alasan tertulis (min. 5 karakter) diterima dan disimpan di order', async () => {
    const tx = fakeTx();
    await assertPaymentRecordedOrExplained(tx, job, 'teknisi', ' Pelanggan belum gajian, bayar besok ');
    expect(tx.serviceOrder.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { unpaidReason: 'Pelanggan belum gajian, bayar besok' } });
  });

  it('pembayaran lapangan sudah tercatat (selain yang ditolak): lolos tanpa alasan', async () => {
    const tx = fakeTx({ recorded: 1 });
    await expect(assertPaymentRecordedOrExplained(tx, job, 'teknisi')).resolves.toBeUndefined();
    expect(tx.fieldPayment.count).toHaveBeenCalledWith({ where: { orderId: 'o1', status: { not: 'ditolak' } } });
  });

  it.each([
    ['admin', { role: 'admin' as const, job, tx: fakeTx() }],
    ['pemasangan', { role: 'teknisi' as const, job: { ...job, type: 'pemasangan' }, tx: fakeTx() }],
    ['komplain', { role: 'teknisi' as const, job: { ...job, complaintOfJobId: 'j0' }, tx: fakeTx() }],
    ['order ditagih admin', { role: 'teknisi' as const, job, tx: fakeTx({ paymentMode: 'ditagih_admin' }) }],
    ['order belum punya invoice', { role: 'teknisi' as const, job, tx: fakeTx({ invoiceId: null }) }],
    ['tagihan Rp 0 (garansi/gratis)', { role: 'teknisi' as const, job, tx: fakeTx({ grand: 0 }) }],
    ['tagihan sudah lunas', { role: 'teknisi' as const, job, tx: fakeTx({ paid: 150000 }) }],
  ])('tidak menghalangi: %s', async (_n, c) => {
    await expect(assertPaymentRecordedOrExplained(c.tx, c.job, c.role)).resolves.toBeUndefined();
  });
});
```

Run: `npx jest src/technician-jobs/payment-gate.util.spec.ts`
Expected: FAIL ("Cannot find module").

- [ ] **Step 2: Util**

Buat `src/technician-jobs/payment-gate.util.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;
type Role = 'admin' | 'kasir' | 'teknisi' | 'gudang';

/**
 * Gerbang Ajukan Selesai untuk order `bayar_di_lokasi`: teknisi wajib sudah mencatat pembayaran (selain yang ditolak admin)
 * ATAU menulis alasan (mis. pelanggan belum bisa membayar; disimpan di `service_orders.unpaid_reason` untuk admin).
 * Tidak berlaku untuk admin, pemasangan, komplain, order `ditagih_admin`, order tanpa invoice, dan tagihan Rp 0 / sudah lunas.
 */
export async function assertPaymentRecordedOrExplained(
  tx: Tx,
  job: { id: string; orderId: string; type: string; complaintOfJobId: string | null },
  role: Role,
  unpaidReason?: string,
): Promise<void> {
  if (role === 'admin') return;
  if (job.type === 'pemasangan' || job.complaintOfJobId) return;
  const order = await tx.serviceOrder.findUnique({
    where: { id: job.orderId },
    select: { paymentMode: true, invoiceId: true },
  });
  if (!order || order.paymentMode !== 'bayar_di_lokasi' || !order.invoiceId) return;

  const recorded = await tx.fieldPayment.count({ where: { orderId: job.orderId, status: { not: 'ditolak' } } });
  if (recorded > 0) return;

  const inv = await tx.invoice.findUnique({ where: { id: order.invoiceId }, select: { grandTotal: true, totalPaid: true } });
  if (!inv || Number(inv.grandTotal) - Number(inv.totalPaid) <= 0) return;

  const reason = unpaidReason?.trim() ?? '';
  if (reason.length >= 5) {
    await tx.serviceOrder.update({ where: { id: job.orderId }, data: { unpaidReason: reason } });
    return;
  }
  throw new BadRequestException(
    'Order ini dibayar di lokasi: catat pembayaran dulu, atau isi alasan bila pelanggan belum bisa membayar.',
  );
}
```

Run: `npx jest src/technician-jobs/payment-gate.util.spec.ts` → PASS.

- [ ] **Step 3: DTO + penyambungan**

`dto/submit-for-review.dto.ts`: ganti isi menjadi

```ts
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body opsional `PATCH /technician-jobs/:id/submit-for-review`. */
export class SubmitForReviewDto {
  /** Servis banyak AC: ajukan selesai SELURUH job (semua unit di order ini) sekaligus, bukan satu unit. */
  @IsOptional() @IsBoolean() allInOrder?: boolean;

  /**
   * Order bayar_di_lokasi tanpa pembayaran tercatat: alasan teknisi (min. 5 karakter), mis. pelanggan belum bisa membayar.
   * Tidak perlu bila pembayaran sudah dicatat.
   */
  @IsOptional() @IsString() @MaxLength(500) unpaidReason?: string;
}
```

Di `technician-jobs.service.ts`:
1. Impor `import { assertPaymentRecordedOrExplained } from './payment-gate.util';`.
2. `submitForReview(jobId, actorId, role, opts: { allInOrder?: boolean; unpaidReason?: string } = {})`: teruskan `opts` ke `submitOrderForReview(jobId, actorId, role, opts.unpaidReason)` dan ke `submitJobInTx(tx, jobId, actorId, role, opts.unpaidReason)`.
3. `private async submitOrderForReview(jobId, actorId, role, unpaidReason?: string)`: teruskan `unpaidReason` pada pemanggilan `this.submitJobInTx(tx, j.id, actorId, role, unpaidReason)`.
4. `private async submitJobInTx(tx, jobId, actorId, role, unpaidReason?: string)`: sesudah blok `unusedApproved` dan SEBELUM `return tx.technicianJob.update(...)`, tambahkan:

```ts
    // Order bayar_di_lokasi: pembayaran harus sudah dicatat, atau ada alasan tertulis (lihat payment-gate.util.ts).
    await assertPaymentRecordedOrExplained(tx, job, role, unpaidReason);
```

Di `technician-jobs.controller.ts`, rute `submit-for-review` (cari `submitForReview(`): teruskan `unpaidReason: dto.unpaidReason` bersama `allInOrder` pada objek opsi.

Pemanggil lain `submitForReview` (mis. `offline-sync.service.ts`) tidak mengirim alasan — dibiarkan; order lama berstatus `ditagih_admin` tidak kena gerbang.

- [ ] **Step 4: Tes penyambungan**

Spec yang tx tiruannya belum punya `serviceOrder.findUnique` / `fieldPayment` / `invoice` akan gagal. Untuk setiap spec yang memanggil `submitForReview`/`submitJobInTx` (cari dengan `grep -rln "submitForReview" src --include=*.spec.ts`), tambahkan di bagian atas file:

```ts
jest.mock('./payment-gate.util', () => ({ assertPaymentRecordedOrExplained: jest.fn(async () => undefined) }));
```

(sesuaikan path relatif bila spec berada di folder lain), lalu tambahkan SATU tes penyambungan di `technician-jobs.multi-unit.spec.ts` (dekat `submitSetup`) yang membuktikan gerbang dipanggil dengan alasan yang diteruskan:

```ts
import { assertPaymentRecordedOrExplained } from './payment-gate.util';

it('Ajukan Selesai: gerbang pembayaran dipanggil dengan peran dan alasan dari klien', async () => {
  (assertPaymentRecordedOrExplained as jest.Mock).mockClear();
  const { svc, tx } = submitSetup({});
  await svc.submitForReview('j1', 't1', 'teknisi', { unpaidReason: 'Pelanggan belum bisa bayar' });
  expect(assertPaymentRecordedOrExplained).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({ id: 'j1' }),
    'teknisi',
    'Pelanggan belum bisa bayar',
  );
});
```

(Bentuk `submitSetup`/`tx` mengikuti helper yang sudah ada di file itu; sesuaikan seminimal mungkin dan laporkan. Bila `submitSetup` tidak mengembalikan `tx`, ambil dari objek yang dikembalikan atau tambahkan ke return.)

- [ ] **Step 5: Verifikasi dan commit**

Run: `npx tsc --noEmit && npx jest && npm run build`
Expected: tsc bersih, semua suite PASS, build sukses.

```bash
git add src/technician-jobs
git commit -m "feat(pembayaran): Ajukan Selesai di order bayar_di_lokasi butuh pembayaran tercatat atau alasan tertulis"
```

---

### Task 8: Verifikasi dan dokumentasi

- [ ] **Step 1: Seluruh tes dan build**

Run: `npx tsc --noEmit && npx jest && npm run build`
Expected: tsc bersih; semua suite PASS; build sukses.

- [ ] **Step 2: CLAUDE.md (root `Nest/`, tidak ikut git)**

Tambahkan bullet sesudah bullet "Harga jasa untuk teknisi":

```markdown
- **Pembayaran lapangan teknisi + Tanda Terima** (2026-11; migrasi `20261112000000_field_payments`; rencana 3 pembayaran lapangan; modul `src/field-payments/`): pada order `payment_mode = bayar_di_lokasi`, teknisi assignee mencatat pembayaran yang ia terima (`POST /technician-jobs/:jobId/field-payments`, multipart: `method`, `amount` bulat, `note?`, `clientRef?`, file `proof` WAJIB untuk semua metode). Tabel `field_payments` (status `dipegang_teknisi` untuk tunai, `menunggu_cocok` untuk non-tunai; `diverifikasi`/`ditolak` dipakai rencana 4). **TIDAK mengubah `invoices.total_paid`/`status`**: pelunasan baru saat admin memverifikasi setoran/mutasi (rencana 4, belum ada). Gerbang pencatatan (`gateReason`): job `sedang_dikerjakan`, bukan pemasangan/komplain, order `bayar_di_lokasi` dan sudah dihargai, TIDAK ada pengajuan sparepart `pending` dan semua yang disetujui sudah dilaporkan terpakai (total harus final); nominal ≤ sisa tagihan − pembayaran lapangan aktif; bayar sebagian wajib `note`. Nomor `TT-YYYYMMDD-NNNN` (counter `tanda_terima_<dateKey>`). Tanda Terima: `POST /field-payments/:id/send-receipt` (`channel` `wa` bawaan lewat nomor toko Fonnte, jenis log `tanda_terima`, teks 4 baris tanpa tautan di `receipt-message.util.ts`; atau `kertas` + `paperReportNo`); gagal WA = `sent:false` + alasan, bukan error. Baca: `GET /technician-jobs/:jobId/field-payments` (ringkasan + `canRecord`/`blockedReason`), `GET /field-payments/mine` (uang yang saya pegang). Penjaga: `PaymentsService.record` menghitung pembayaran lapangan aktif (tak boleh dibayar ganda), `techEditLines` terkunci setelah ada pembayaran lapangan selain yang ditolak, `assertLastJobCancelAllowed` menolak pembatalan job terakhir bila ada pembayaran aktif, dan **Ajukan Selesai** di order `bayar_di_lokasi` butuh pembayaran tercatat ATAU `unpaidReason` (≥5 karakter, tersimpan di `service_orders.unpaid_reason`; admin, pemasangan, komplain, order ditagih_admin, tagihan Rp 0/lunas dikecualikan; `submit-for-review` menerima `unpaidReason`). Admin dikabari (notif `field_payment`, realtime `field_payment.created`). Belum: setoran/verifikasi/Cocokkan Mutasi (rencana 4), UI web/Flutter, ikon lonceng untuk notif baru.
```

- [ ] **Step 3: Periksa diff**

Run: `git status --short && git log --oneline -9`
Expected: hanya berkas docs/plans/specs/`.codex`/`Nest/.claude`/`skills-lock.json` yang untracked.

---

## Self-Review (terhadap spesifikasi)

- **Catat nominal + metode + foto bukti (wajib semua metode), status per metode, nomor TT, idempoten**: Task 1, 3, 5.
- **Batas nominal terhadap sisa, bayar sebagian wajib catatan, penjaga ganda bayar**: Task 3, 6.
- **Gerbang sparepart final (asumsi 9)**: Task 3 (`gateReason`).
- **Gerbang Ajukan Selesai (asumsi 4) dengan alasan tertulis**: Task 7.
- **Tanda Terima: dokumen terpisah, WA nomor toko, pesan pendek; pelanggan tanpa HP / tanpa sinyal → kertas; gagal kirim tidak memblokir**: Task 2, 4.
- **Kunci edit jasa setelah ada pembayaran (asumsi 3 + spesifikasi)**: Task 6.
- **Pembatalan job dengan uang aktif ditolak**: Task 6.
- **Admin dikabari**: Task 5.
- **Sengaja ditunda ke rencana 4**: verifikasi tunai/non-tunai (menjadi `ManualPayment`), setoran, selisih, saldo teknisi, cek sparepart kembali, dari kertas oleh admin, cron `cash_overdue`, laporan.
- **Konsistensi nama**: `gateReason`, `ACTIVE_FIELD_PAYMENT_STATUSES`, `STATUS_HELD/AWAITING_MATCH/VERIFIED/REJECTED`, `buildReceiptMessage`, `assertPaymentRecordedOrExplained`, `unpaidReason`, `field_payment.create`, `field_payment.receipt_sent` dipakai sama di semua task.
