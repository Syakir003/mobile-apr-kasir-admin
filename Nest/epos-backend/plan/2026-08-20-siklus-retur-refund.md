# E-POS AC — Implementation Plan: Siklus 5 — Retur / Refund Barang (Kasir)

**Goal:** Kasir bisa proses retur barang retail (produk/sparepart) yang sudah terjual dalam satu transaksi — validasi gak boleh retur lebih dari yang pernah dibeli, stok balik otomatis, invoice ke-adjust (grand total turun), dan ada riwayat retur per transaksi yang bisa dicek admin/kasir.

**Tech Stack:** NestJS + TypeScript, Prisma + PostgreSQL, `class-validator`/`class-transformer` — reuse penuh infrastruktur dari Siklus 1 (`PrismaService`, `JwtAuthGuard`+`RolesGuard`+`@Roles()`, `CurrentUser`, `AuditLog`, `computeInvoiceStatus`).

---

## Ruang lingkup siklus ini

**Termasuk:** endpoint `POST /returns` (buat retur baru dari kasir), endpoint `GET /returns?transactionId=` (riwayat retur), migration tabel `returns`+`return_items`, validasi anti-retur-ganda (qty retur gak boleh melebihi qty yang pernah dibeli dikurangi yang udah pernah diretur), pengembalian stok, pencatatan `stock_movements`, dan penyesuaian `invoices.grand_total`+`status` lewat `invoice_adjustments`.

**Sengaja di luar scope:** pembatalan/retur **servis/jasa** (alur beda total — servis udah dikerjain, gak ada barang fisik yang "dikembalikan"; kalau nanti dibutuhin, itu plan terpisah). Endpoint ini secara eksplisit **menolak** item transaksi berkind `service`. Juga di luar scope: retur sebagian dari job pemasangan (unit AC yang udah kepasang), refund ke metode pembayaran tertentu (cash/transfer balik) — itu keputusan operasional kasir di luar sistem, sistem cuma catat `refundAmount` dan `overpaidAmount` biar kasir tau berapa yang harus dibalikin secara fisik.

## Keputusan desain

1. **`invoice_adjustments.amount` dipakai negatif buat retur.** Tabel ini sebelumnya (Siklus 1) dipakai buat diskon ad-hoc dengan `amount` positif (`+diskon`). Di siklus ini, retur diinsert dengan `amount = -refundAmount` (negatif). Alasannya: biar `SUM(invoice_adjustments.amount)` per invoice langsung merepresentasikan total pengurangan bersih ke invoice (diskon dan retur sama-sama "pengurangan", cuma beda tanda kalau nanti ada kasus lain yang nambah) tanpa perlu join tambahan atau kolom `type` buat bedain. **Ini keputusan produk yang perlu dikonfirmasi ke tim** — kalau tim lebih nyaman `amount` selalu positif dengan makna kontekstual (butuh kolom `adjustment_type` tambahan buat bedain diskon vs retur), kasih tau sebelum migration jalan ke production, soalnya ganti konvensi belakangan berarti migration data ulang ke seluruh row `invoice_adjustments` yang udah ada.
2. **Kolom `request_id` di `invoice_adjustments` TIDAK dipakai di sini.** Kolom itu nullable dan sudah ada dari schema asli, tapi makna aslinya buat nyambungin ke `material_requests` (potongan/biaya sparepart teknisi). Retur diinsert dengan `request_id = null` — jangan diisi ID `returns`, soalnya beda FK target (bakal salah kalau ada yang query join `request_id → material_requests` lalu ketemu ID yang gak match tabel itu).
3. **`return_items.transaction_item_id` adalah kunci validasi anti-retur-ganda.** Tiap baris retur wajib nunjuk ke `transaction_items.id` yang jelas asalnya dari transaksi apa dan qty aslinya berapa. Validasi qty dihitung dari `SUM(return_items.qty)` yang udah ada buat `transaction_item_id` yang sama, bukan dari field counter terpisah di `transaction_items` (biar gak perlu migration tambahan ke tabel yang sudah ada, dan histori tetap lengkap by-design).
4. **Dependency opsional ke Siklus 3 (`StockLockingService.lockAndAdd`).** Siklus 3 (servis teknisi/sparepart) rencananya nambah method `lockAndAdd` di `StockLockingService` yang jadi mirror `lockAndDeduct` (lock row, tambah stok). Kalau Siklus 3 **belum selesai** duluan, plan ini tetap harus bisa jalan berdiri sendiri — makanya `ReturnsService` di bawah pakai implementasi inline (`addStockBack` private method, row-lock manual `FOR UPDATE` + `UPDATE stock = stock + qty`) yang logic-nya identik. **Begitu Siklus 3 selesai, WAJIB ganti pemanggilan ke `this.stockLocking.lockAndAdd(tx, kind, id, qty)` dan hapus `addStockBack`** — jangan biarin dua implementasi lock-stok yang mirip-tapi-beda hidup berdampingan selamanya, itu sumber bug pas salah satu diubah tapi yang lain lupa diikutin.
5. **Retur dikunci per-`transaction_item_id` pakai `SELECT ... FOR UPDATE` ke `transaction_items`**, bukan cuma baca-hitung-insert biasa. Ini nutup race condition kalau ada 2 request retur ke item yang sama masuk barengan (mis. dobel-klik tombol submit di kasir) — pola locking sama persis semangatnya kayak `StockLockingService.lockAndDeduct` di Siklus 1, cuma target row-nya beda (row transaksi, bukan row stok).
6. **`refundAmount` dihitung dari harga jual asli di `transaction_items.unit_price`**, bukan input manual kasir — biar konsisten dan gak bisa diakalin refund lebih besar dari harga beli asli.
7. **Overpaid detection**: kalau invoice udah lunas (atau DP lebih dari sisa tagihan baru setelah retur), `grand_total` yang lebih kecil bisa bikin `total_paid > grand_total` baru. Ini bukan error — sistem cuma flag `overpaidAmount` di response biar kasir tau harus balikin uang cash ke customer secara manual (sistem gak megang uang fisik).

## Peta modul

```
src/
  returns/
    returns.module.ts
    returns.controller.ts
    returns.service.ts
    dto/create-return.dto.ts
  common/services/stock-locking.service.ts   → (reuse dari Siklus 1; tambahan lockAndAdd nanti dari Siklus 3, opsional)
  pos/pos-calc.util.ts                        → (reuse computeInvoiceStatus dari Siklus 1, jangan bikin ulang)
  prisma/prisma.service.ts                    → (reuse)
  auth/                                       → (reuse guards & decorators)
```

---

## Fase 1 — Migration Schema

### Task 1.1: Tambah model `Return` & `ReturnItem` ke `schema.prisma`

**File:** Modify `prisma/schema.prisma`, lalu `npx prisma migrate dev --name returns_refund`

```prisma
model Return {
  id            String   @id @default(cuid())
  transactionId String   @map("transaction_id")
  memberId      String?  @map("member_id")
  reason        String
  createdBy     String   @map("created_by")
  createdAt     DateTime @default(now()) @map("created_at")
  refundAmount  Decimal  @db.Decimal(14, 2) @map("refund_amount")

  transaction   Transaction  @relation(fields: [transactionId], references: [id])
  member        Member?      @relation(fields: [memberId], references: [id])
  items         ReturnItem[]

  @@index([transactionId])
  @@map("returns")
}

model ReturnItem {
  id                String  @id @default(cuid())
  returnId          String  @map("return_id")
  transactionItemId String  @map("transaction_item_id")
  kind              String
  refId             String? @map("ref_id")
  name              String
  qty               Decimal @db.Decimal(10, 2)
  unitPrice         Decimal @db.Decimal(14, 2) @map("unit_price")
  lineTotal         Decimal @db.Decimal(14, 2) @map("line_total")

  return          Return          @relation(fields: [returnId], references: [id])
  transactionItem TransactionItem @relation(fields: [transactionItemId], references: [id])

  @@index([transactionItemId])
  @@map("return_items")
}
```

Kolom-kolom ini persis mengikuti nama kolom EXACT dari dump SQL asli buat tabel-tabel yang direferensikan (`transaction_items.id/kind/ref_id/name/unit_price`, `invoices.grand_total/total_paid/status`, `invoice_adjustments.amount/reason/request_id`, `stock_movements.item_kind/ref_id/qty_change/reason/transaction_id`) — gak ada kolom yang dikarang.

**Jangan lupa** tambahin relasi balik di model yang udah ada (biar Prisma gak komplain relasi sepihak):
```prisma
// di dalam model Transaction (yang sudah ada):
returns Return[]

// di dalam model Member (yang sudah ada):
returns Return[]

// di dalam model TransactionItem (yang sudah ada):
returnItems ReturnItem[]
```

**Verifikasi:** `npx prisma migrate dev` sukses, `npx prisma studio` nampilin 2 tabel baru `returns` dan `return_items` dengan relasi FK ke `transactions`, `members`, `transaction_items` kekliatan di UI.

---

## Fase 2 — ReturnsService (logic inti)

### Task 2.1: DTO

**File:** Create `src/returns/dto/create-return.dto.ts`

```typescript
import { Type } from 'class-transformer';
import { ArrayMinSize, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ReturnItemDto {
  @IsString() @IsNotEmpty() transactionItemId: string;
  @IsNumber() @Min(0.01) qty: number;
  @IsOptional() @IsString() reasonDetail?: string;
}

export class CreateReturnDto {
  @IsString() @IsNotEmpty() transactionId: string;
  @IsString() @IsNotEmpty() reason: string; // alasan retur keseluruhan, wajib diisi kasir
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  @ArrayMinSize(1)
  items: ReturnItemDto[];
}
```

**Verifikasi:** POST body tanpa `reason` atau `items: []` → `ValidationPipe` global (sudah didaftarkan di `main.ts` sejak Siklus 1) balikin 400 otomatis.

### Task 2.2: `ReturnsService.createReturn` — transaksi utama

**File:** Create `src/returns/returns.service.ts`

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeInvoiceStatus } from '../pos/pos-calc.util';
import { CreateReturnDto } from './dto/create-return.dto';

@Injectable()
export class ReturnsService {
  constructor(private prisma: PrismaService) {}

  async createReturn(dto: CreateReturnDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({ where: { id: dto.transactionId } });
      if (!transaction) throw new NotFoundException('Transaksi tidak ditemukan');

      const invoice = await tx.invoice.findFirst({ where: { transactionId: dto.transactionId } });
      if (!invoice) throw new NotFoundException('Invoice untuk transaksi ini tidak ditemukan');

      // urutkan by transactionItemId dulu — konsisten sama pola anti-deadlock di StockLockingService (Siklus 1)
      const sortedLines = [...dto.items].sort((a, b) => a.transactionItemId.localeCompare(b.transactionItemId));

      let refundAmount = 0;
      const lineRecords: {
        transactionItemId: string; kind: string; refId: string | null;
        name: string; qty: number; unitPrice: number; lineTotal: number;
      }[] = [];

      for (const line of sortedLines) {
        // 1) lock baris transaction_item ini — walau gak diupdate, ini nyerialisasiin 2 request retur
        //    barengan ke item yang sama (misal kasir dobel-klik submit)
        const rows: any[] = await tx.$queryRaw`
          SELECT id, transaction_id, kind, ref_id, name, qty, unit_price
          FROM transaction_items WHERE id = ${line.transactionItemId} FOR UPDATE
        `;
        const ti = rows[0];
        if (!ti) throw new BadRequestException(`Item transaksi ${line.transactionItemId} tidak ditemukan`);
        if (ti.transaction_id !== dto.transactionId)
          throw new BadRequestException(
            `Item ${line.transactionItemId} bukan bagian dari transaksi ${dto.transactionId}`,
          );
        if (ti.kind === 'service')
          throw new BadRequestException(
            `"${ti.name}" adalah jasa/servis — retur jasa gak didukung di endpoint ini (di luar scope, servis punya alur pembatalan sendiri)`,
          );

        // 2) validasi anti-retur-ganda: qty yang diretur SEKARANG gak boleh melebihi
        //    qty asli DIKURANGI total yang sudah pernah diretur sebelumnya untuk item yang sama
        const already = await tx.returnItem.aggregate({
          where: { transactionItemId: line.transactionItemId },
          _sum: { qty: true },
        });
        const alreadyReturnedQty = Number(already._sum.qty ?? 0);
        const maxReturnable = Number(ti.qty) - alreadyReturnedQty;
        if (line.qty > maxReturnable)
          throw new BadRequestException(
            `Qty retur "${ti.name}" (${line.qty}) melebihi sisa yang bisa diretur (${maxReturnable}). ` +
              `Qty asli: ${ti.qty}, sudah diretur sebelumnya: ${alreadyReturnedQty}.`,
          );

        // 3) balikin stok (product/sparepart aja, service udah ditolak di atas)
        await this.addStockBack(tx, ti.kind, ti.ref_id, line.qty);
        await tx.stockMovement.create({
          data: {
            itemKind: ti.kind,
            refId: ti.ref_id,
            name: ti.name,
            qtyChange: line.qty, // positif — nambah stok balik
            reason: 'retur',
            transactionId: dto.transactionId, // stock_movements gak punya kolom return_id, transaction_id dipakai buat traceability ke transaksi asal
            createdBy: actorId,
          },
        });

        const unitPrice = Number(ti.unit_price);
        const lineTotal = Math.round(line.qty * unitPrice);
        refundAmount += lineTotal;
        lineRecords.push({
          transactionItemId: line.transactionItemId, kind: ti.kind, refId: ti.ref_id,
          name: ti.name, qty: line.qty, unitPrice, lineTotal,
        });
      }

      // 4) grand_total baru gak boleh negatif (kalau invoice-nya udah kena diskon besar,
      //    refundAmount dari harga asli bisa lebih gede dari sisa grand_total)
      const newGrandTotal = Number(invoice.grandTotal) - refundAmount;
      if (newGrandTotal < 0)
        throw new BadRequestException('Total refund melebihi grand total invoice — cek ulang item yang diretur');

      // 5) insert returns + return_items
      const returnRow = await tx.return.create({
        data: {
          transactionId: dto.transactionId,
          memberId: transaction.memberId,
          reason: dto.reason,
          createdBy: actorId,
          refundAmount,
        },
      });
      for (const l of lineRecords) {
        await tx.returnItem.create({
          data: {
            returnId: returnRow.id, transactionItemId: l.transactionItemId, kind: l.kind,
            refId: l.refId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
          },
        });
      }

      // 6) invoice_adjustments — amount NEGATIF (lihat "Keputusan desain" #1), request_id sengaja null (#2)
      await tx.invoiceAdjustment.create({
        data: { invoiceId: invoice.id, amount: -refundAmount, reason: dto.reason, createdBy: actorId },
      });

      // 7) update invoice: grand_total turun, status di-recompute, deteksi overpaid
      const totalPaid = Number(invoice.totalPaid);
      const newStatus = computeInvoiceStatus(newGrandTotal, totalPaid);
      const overpaidAmount = totalPaid > newGrandTotal ? Math.round((totalPaid - newGrandTotal) * 100) / 100 : 0;
      await tx.invoice.update({ where: { id: invoice.id }, data: { grandTotal: newGrandTotal, status: newStatus } });

      await tx.auditLog.create({
        data: {
          actorUid: actorId, action: 'returns.create', target: returnRow.id,
          detail: { transactionId: dto.transactionId, invoiceId: invoice.id, refundAmount, newGrandTotal },
        },
      });

      return {
        returnId: returnRow.id,
        refundAmount,
        invoiceId: invoice.id,
        newGrandTotal,
        newStatus,
        overpaidAmount, // > 0 berarti kasir wajib balikin cash sejumlah ini ke customer
      };
    });
  }

  /**
   * TODO(dependency Siklus 3): begitu StockLockingService.lockAndAdd(tx, kind, id, qty) selesai
   * dikerjain di Siklus 3, GANTI pemanggilan addStockBack() di atas jadi
   * `this.stockLocking.lockAndAdd(tx, kind, id, qty)` dan HAPUS method ini — jangan biarin dua
   * implementasi lock-stok yang mirip hidup berdampingan, itu sumber bug kalau salah satu
   * diubah belakangan tapi yang satu lagi lupa diikutin.
   */
  private async addStockBack(tx: any, kind: 'product' | 'sparepart', id: string, qty: number) {
    const table = kind === 'product' ? 'products' : 'spareparts';
    const rows: any[] = await tx.$queryRawUnsafe(`SELECT id, name FROM ${table} WHERE id = $1 FOR UPDATE`, id);
    if (!rows[0]) throw new BadRequestException(`${kind} ${id} tidak ditemukan, gak bisa balikin stok`);
    await tx.$executeRawUnsafe(`UPDATE ${table} SET stock = stock + $1 WHERE id = $2`, qty, id);
  }

  async listByTransaction(transactionId: string) {
    return this.prisma.return.findMany({
      where: { transactionId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

**Verifikasi:**
- Unit/integration test paling penting di plan ini — **anti-retur-ganda**:
```typescript
it('gak bisa retur lebih dari qty yang pernah dibeli', async () => {
  // seed: transaksi dengan transaction_item qty=2, product stock awal 5
  const first = await returnsService.createReturn(
    { transactionId: 'trx1', reason: 'rusak', items: [{ transactionItemId: 'ti1', qty: 2 }] },
    'kasir1',
  );
  expect(first.refundAmount).toBeGreaterThan(0);

  // retur lagi ke item yang sama, padahal qty aslinya cuma 2 dan udah full diretur
  await expect(
    returnsService.createReturn(
      { transactionId: 'trx1', reason: 'coba retur lagi', items: [{ transactionItemId: 'ti1', qty: 1 }] },
      'kasir1',
    ),
  ).rejects.toThrow(/melebihi sisa yang bisa diretur/);
});

it('retur sebagian masih boleh sampai sisa habis', async () => {
  // transaction_item qty=3
  await returnsService.createReturn(
    { transactionId: 'trx2', reason: 'salah beli', items: [{ transactionItemId: 'ti2', qty: 1 }] },
    'kasir1',
  );
  // sisa masih 2, retur 2 lagi harus lolos
  const second = await returnsService.createReturn(
    { transactionId: 'trx2', reason: 'salah beli lagi', items: [{ transactionItemId: 'ti2', qty: 2 }] },
    'kasir1',
  );
  expect(second.refundAmount).toBeGreaterThan(0);
  // retur ke-3 (qty berapa pun) harus ditolak, sisa udah 0
  await expect(
    returnsService.createReturn(
      { transactionId: 'trx2', reason: 'coba lagi', items: [{ transactionItemId: 'ti2', qty: 0.01 }] },
      'kasir1',
    ),
  ).rejects.toThrow(/melebihi sisa yang bisa diretur/);
});

it('retur item kind service ditolak', async () => {
  // transaction_item ti-jasa punya kind='service'
  await expect(
    returnsService.createReturn(
      { transactionId: 'trx3', reason: 'batal servis', items: [{ transactionItemId: 'ti-jasa', qty: 1 }] },
      'kasir1',
    ),
  ).rejects.toThrow(/retur jasa gak didukung/);
});

it('stok balik dan stock_movements tercatat setelah retur produk', async () => {
  const before = await prisma.product.findUnique({ where: { id: 'p1' } });
  await returnsService.createReturn(
    { transactionId: 'trx4', reason: 'cacat', items: [{ transactionItemId: 'ti4', qty: 1 }] },
    'kasir1',
  );
  const after = await prisma.product.findUnique({ where: { id: 'p1' } });
  expect(after.stock).toBe(before.stock + 1);
  const movement = await prisma.stockMovement.findFirst({ where: { refId: 'p1', reason: 'retur' } });
  expect(Number(movement!.qtyChange)).toBe(1);
});

it('overpaidAmount kehitung kalau invoice udah lunas sebelum retur', async () => {
  // invoice grand_total=1000000, total_paid=1000000 (lunas), retur bikin grand_total baru=700000
  const result = await returnsService.createReturn(
    { transactionId: 'trx5', reason: 'kembaliin barang', items: [{ transactionItemId: 'ti5', qty: 1 }] },
    'kasir1',
  );
  expect(result.overpaidAmount).toBe(300000); // kasir harus balikin cash 300rb ke customer
  expect(result.newStatus).toBe('lunas');
});
```

---

## Fase 3 — Controller & Module

### Task 3.1: `ReturnsController`

**File:** Create `src/returns/returns.controller.ts`

```typescript
import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReturnsService } from './returns.service';
import { CreateReturnDto } from './dto/create-return.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('returns')
export class ReturnsController {
  constructor(private returnsService: ReturnsService) {}

  @Roles('admin', 'kasir')
  @Post()
  async create(@Body() dto: CreateReturnDto, @CurrentUser() user: any) {
    return this.returnsService.createReturn(dto, user.sub);
  }

  @Roles('admin', 'kasir')
  @Get()
  async list(@Query('transactionId') transactionId: string) {
    if (!transactionId) throw new BadRequestException('Query transactionId wajib diisi');
    return this.returnsService.listByTransaction(transactionId);
  }
}
```

### Task 3.2: `ReturnsModule`

**File:** Create `src/returns/returns.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
})
export class ReturnsModule {}
```
Daftarin `ReturnsModule` ke `imports` di `AppModule` (`src/app.module.ts`).

**Verifikasi:**
- `POST /returns` tanpa token → 401. Dengan token role `teknisi` → 403. Dengan token role `kasir`/`admin` → lolos guard.
- `POST /returns` dengan `transactionItemId` yang bukan milik `transactionId` yang dikirim → 400 dengan pesan "bukan bagian dari transaksi".
- `GET /returns?transactionId=trx1` balikin array retur beserta `items` nested, terurut `createdAt desc`.
- `GET /returns` tanpa query `transactionId` → 400.

---

## Skenario tes end-to-end

1. Login kasir → `POST /pos/checkout` (dari Siklus 1) jual 1 sparepart qty=3 dalam 1 transaksi → catat `invoiceId`, `transactionId`, dan cari `transactionItemId` sparepart itu lewat `GET /invoices/:id` (Siklus 1).
2. Cek stok sparepart di `GET /spareparts/:id` — turun 3 dari sebelumnya.
3. `POST /returns` retur qty=1 dari item itu, `reason: "customer gak jadi pakai"` → response `refundAmount` = 1 × harga satuan, `overpaidAmount` sesuai kondisi invoice.
4. Cek stok sparepart naik lagi +1 (`GET /spareparts/:id`).
5. Cek `stock_movements` ada row baru `reason='retur'`, `qty_change=1`.
6. Cek `GET /invoices/:id` (Siklus 1) — `grandTotal` turun sejumlah `refundAmount`, ada `invoiceAdjustments` baru dengan `amount` negatif dan `reason` sama kayak alasan retur.
7. Coba `POST /returns` lagi ke `transactionItemId` yang sama dengan qty=3 (padahal sisa cuma 2) → 400 "melebihi sisa yang bisa diretur".
8. `POST /returns` qty=2 (pas sisa) → sukses, refund kedua kali kehitung.
9. `POST /returns` lagi ke item yang sama qty berapa pun → 400 (sisa udah 0).
10. `GET /returns?transactionId=trx-tadi` → muncul 2 row retur (langkah 3 & 8), tiap row ada `items` nested.
11. Coba retur item transaksi yang `kind='service'` dari transaksi yang sama (kalau ada) → 400 "retur jasa gak didukung".

Kalau semua 11 langkah lolos, siklus retur/refund barang udah jalan penuh end-to-end.

---

## Dependency

- **Siklus 1 (wajib, hard dependency)** — butuh `PrismaService`, `JwtAuthGuard`+`RolesGuard`+`@Roles()`+`CurrentUser`, `computeInvoiceStatus` dari `pos/pos-calc.util.ts`, `AuditLog` pattern, dan tabel `transactions`/`transaction_items`/`invoices`/`invoice_adjustments`/`stock_movements`/`products`/`spareparts` yang sudah ada dari checkout. Gak bisa jalan sebelum Siklus 1 selesai.
- **Siklus 3 (opsional/soft dependency)** — kalau `StockLockingService.lockAndAdd` udah ada, `ReturnsService.addStockBack` WAJIB diganti manggil method itu (lihat TODO di Task 2.2) biar gak ada duplikasi logic lock-stok. Kalau Siklus 3 belum jalan duluan, plan ini tetap bisa diimplementasi & dites penuh berdiri sendiri pakai fallback inline yang sudah ditulis di atas.
