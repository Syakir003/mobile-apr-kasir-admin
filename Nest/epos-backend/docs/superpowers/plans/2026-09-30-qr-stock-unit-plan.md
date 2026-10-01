# QR per Unit Stok Fisik — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiap unit fisik Produk (termasuk AC Indoor/Outdoor) yang masuk gudang dapet QR/kode unik sendiri (`StockUnit`). Checkout POS mereservasi unit (bukan langsung motong stok), dan admin/kasir mengonfirmasi unit yang BENERAN keluar dari gudang lewat halaman baru "Kasir Scan" (kamera QR atau ceklist manual) — di situlah stok resmi berkurang.

**Architecture:** Model baru `StockUnit` (1 baris = 1 unit fisik, status `di_gudang`→`reserved`→`keluar`) jadi satu-satunya sumber kebenaran stok Produk, menggantikan `ItemCost.stock` (dipensiunkan buat `kind='product'`, kolom TETAP ada di skema tapi berhenti dipakai). Reuse infrastruktur QR yang udah ada di frontend (`BarcodeQr`, `BarcodeScanner`, `qrcode.react`, `html5-qrcode` — sudah jadi dependency, dipakai buat label unit AC customer).

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend), Next.js App Router + TanStack Query (frontend). Referensi spec: Project doc `specs/2026-09-30-qr-stock-unit-design.md`.

**Konvensi commit:** `git -c user.name="Claude (subagent-driven-development)" -c user.email="claude@sandbox.local" commit -m "..."`, trailer sesuai system reminder sesi.

---

## Task 1: Schema — model `StockUnit` + migration (create + backfill)

**Files:**
- Modify: `prisma/schema.prisma` (tambah model `StockUnit`, tambah back-relation di `Product`, `ItemCost`, `Invoice`)
- Create: `prisma/migrations/20260930000000_qr_stock_units/migration.sql`

- [ ] **Step 1: Tambah model `StockUnit` di `prisma/schema.prisma`**

Taruh setelah model `ItemCost` (sebelum comment `// CUSTOMER (MEMBER) & UNIT AC`):

```prisma
// BARU (Siklus QR per-unit, 2026-09-30) — 1 baris = 1 unit fisik Produk
// (termasuk masing-masing sisi Indoor & Outdoor AC) yang masuk gudang.
// SATU-SATUNYA sumber kebenaran stok Produk sekarang (gantiin
// `ItemCost.stock` yang dipensiunkan buat kind='product', lihat komentar di
// model ItemCost). Cuma buat `kind='product'` — Sparepart (termasuk yang
// batchTracked) TETAP kuantitas/meteran biasa, gak ikut sistem ini (beda
// karakteristik, bisa pecahan).
//
// Lifecycle status: 'di_gudang' (tersedia) -> 'reserved' (dikunci ke 1
// invoice pas checkout, StockLockingService.lockAndDeduct) -> 'keluar'
// (dikonfirmasi fisik keluar gudang lewat scan/ceklist manual di halaman
// Kasir Scan, KasirScanService.fulfillUnit — INI baru titik stok resmi
// abis, BUKAN pas checkout). Gak ada auto-release 'reserved' balik ke
// 'di_gudang' — checkout udah berarti invoice terbit/dibayar, lihat spec
// buat alasan lengkap (fitur void invoice belum ada di sistem).
model StockUnit {
  id         String   @id @default(uuid())
  itemCostId String   @map("item_cost_id")
  itemCost   ItemCost @relation(fields: [itemCostId], references: [id])
  // Didenormalisasi dari ItemCost.refId — query "stok tersedia per produk"
  // (ProductsService.stockFor) jadi gak perlu join ke item_costs tiap saat.
  refId   String  @map("ref_id")
  product Product @relation(fields: [refId], references: [id])

  // Kode manusiawi buat ditampilin di label (misal "PRD-0001-U0007"),
  // dinomori PER PRODUK (bukan global) lewat CountersService.nextSeq
  // key=`stock_unit_${refId}` — lihat StockService.generateStockUnits.
  unitCode String @unique @map("unit_code")
  // Token opaque yang BENERAN di-encode ke QR (bukan unitCode) — sengaja
  // random/gak bisa ditebak, beda dari unitCode yang predictable/sequential.
  qrToken String @unique @map("qr_token")

  // 'di_gudang' | 'reserved' | 'keluar' — lihat komentar lifecycle di atas.
  status String @default("di_gudang")

  reservedForInvoiceId String?  @map("reserved_for_invoice_id")
  reservedForInvoice   Invoice? @relation(fields: [reservedForInvoiceId], references: [id], onDelete: SetNull)
  reservedAt           DateTime? @map("reserved_at")
  soldAt               DateTime? @map("sold_at")
  createdAt            DateTime  @default(now()) @map("created_at")

  @@index([itemCostId])
  @@index([refId, status])
  @@index([reservedForInvoiceId])
  @@map("stock_units")
}
```

- [ ] **Step 2: Tambah back-relation field di 3 model yang udah ada**

Di model `Product` (dekat `pairedWithMe`), tambah:
```prisma
  stockUnits StockUnit[]
```

Di model `ItemCost` (dekat penutup model, setelah `updatedAt`), tambah:
```prisma
  stockUnits StockUnit[]
```

Di model `Invoice` (dekat `items`/`adjustments`), tambah:
```prisma
  reservedStockUnits StockUnit[]
```

- [ ] **Step 3: Tulis migration SQL — create table + backfill + seed counter**

```sql
-- Siklus QR per-unit (2026-09-30): StockUnit jadi satu-satunya sumber
-- kebenaran stok Produk. item_costs.stock TETAP ada (gak di-drop) tapi
-- BERHENTI dipakai buat kind='product' mulai sekarang.

-- 1) Tabel baru.
CREATE TABLE "stock_units" (
  "id" TEXT NOT NULL,
  "item_cost_id" TEXT NOT NULL,
  "ref_id" TEXT NOT NULL,
  "unit_code" TEXT NOT NULL,
  "qr_token" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'di_gudang',
  "reserved_for_invoice_id" TEXT,
  "reserved_at" TIMESTAMP(3),
  "sold_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_units_unit_code_key" ON "stock_units"("unit_code");
CREATE UNIQUE INDEX "stock_units_qr_token_key" ON "stock_units"("qr_token");
CREATE INDEX "stock_units_item_cost_id_idx" ON "stock_units"("item_cost_id");
CREATE INDEX "stock_units_ref_id_status_idx" ON "stock_units"("ref_id", "status");
CREATE INDEX "stock_units_reserved_for_invoice_id_idx" ON "stock_units"("reserved_for_invoice_id");

ALTER TABLE "stock_units" ADD CONSTRAINT "stock_units_item_cost_id_fkey"
  FOREIGN KEY ("item_cost_id") REFERENCES "item_costs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_units" ADD CONSTRAINT "stock_units_ref_id_fkey"
  FOREIGN KEY ("ref_id") REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_units" ADD CONSTRAINT "stock_units_reserved_for_invoice_id_fkey"
  FOREIGN KEY ("reserved_for_invoice_id") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Backfill: semua ItemCost (kind='product', stock>0) yang UDAH ADA
--    sebelum fitur ini di-backfill jadi N baris StockUnit (N = stock saat
--    ini), status 'di_gudang'. Unit-unit ini belum pernah punya label fisik
--    tertempel (dicetak SEBELUM fitur ini ada = gak mungkin) — admin perlu
--    "cetak ulang label" belakangan lewat GET /stock/batches/:itemCostId/units
--    (Task 4) buat nyusulin nempelin QR ke stok lama yang udah numpuk di gudang.
--
--    id & qr_token digenerate pakai trik md5(random()+clock_timestamp())
--    di-cast ke format mirip UUID (TANPA extension tambahan kayak pgcrypto/
--    uuid-ossp — portable di Postgres manapun, beda dari gen_random_uuid()
--    yang butuh PG13+ core atau extension eksplisit yang belum tentu ke-
--    enable). unit_code dinomori PER PRODUK (ROW_NUMBER partition by ref_id,
--    urut created_at batch lalu urutan generate_series) biar konsisten sama
--    skema `${sku}-U0001` yang dipakai StockService.generateStockUnits nanti.
WITH numbered AS (
  SELECT
    ic.id AS item_cost_id,
    ic.ref_id,
    p.sku,
    gs.seq AS seq_in_batch,
    ROW_NUMBER() OVER (PARTITION BY ic.ref_id ORDER BY ic.created_at, ic.id, gs.seq) AS seq_in_product
  FROM item_costs ic
  JOIN products p ON p.id = ic.ref_id
  CROSS JOIN LATERAL generate_series(1, ic.stock::int) AS gs(seq)
  WHERE ic.kind = 'product' AND ic.stock > 0
),
hashed AS (
  SELECT
    n.*,
    md5(random()::text || clock_timestamp()::text || n.item_cost_id || n.seq_in_batch::text || 'id') AS h_id,
    md5(random()::text || clock_timestamp()::text || n.item_cost_id || n.seq_in_batch::text || 'qr') AS h_qr
  FROM numbered n
)
INSERT INTO stock_units (id, item_cost_id, ref_id, unit_code, qr_token, status, created_at)
SELECT
  substr(h_id,1,8)||'-'||substr(h_id,9,4)||'-'||substr(h_id,13,4)||'-'||substr(h_id,17,4)||'-'||substr(h_id,21,12),
  item_cost_id,
  ref_id,
  COALESCE(sku, ref_id) || '-U' || lpad(seq_in_product::text, 4, '0'),
  substr(h_qr,1,8)||'-'||substr(h_qr,9,4)||'-'||substr(h_qr,13,4)||'-'||substr(h_qr,17,4)||'-'||substr(h_qr,21,12),
  'di_gudang',
  CURRENT_TIMESTAMP
FROM hashed;

-- 3) Seed counters.seq per produk biar CountersService.nextSeq('stock_unit_'
--    || refId) yang bakal dipanggil StockService.generateStockUnits buat
--    unit BARU nanti lanjut dari nomor terakhir hasil backfill ini, gak
--    mulai dari 1 lagi (nabrak unit_code yang baru aja dibackfill).
INSERT INTO counters (key, seq)
SELECT 'stock_unit_' || ref_id, COUNT(*)
FROM stock_units
GROUP BY ref_id
ON CONFLICT (key) DO UPDATE SET seq = GREATEST(counters.seq, EXCLUDED.seq);
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260930000000_qr_stock_units/migration.sql
git commit -m "feat(db): tambah model StockUnit + backfill (Siklus QR per-unit)"
```

**Manual step (dicatet, dieksekusi di device user, BUKAN di sandbox — gak ada DB live di sini):**
```bash
npx prisma migrate deploy   # atau `prisma migrate dev` di lingkungan dev
npx prisma generate
```

---

## Task 2: `StockLockingService.lockAndDeduct` — produk sekarang reservasi StockUnit, bukan decrement angka

**Files:**
- Modify: `src/common/services/stock-locking.service.ts`
- Test: `src/common/services/stock-locking.service.spec.ts`

- [ ] **Step 1: Update `LockedItem` interface**

Tambah field baru setelah `batchDeductions`:
```typescript
  // BARU (Siklus QR per-unit, 2026-09-30) — id baris StockUnit yang
  // BENERAN dipilih & di-reserve FIFO (cuma keisi buat kind='product').
  // Dipakai PosService.checkout buat nandain `reservedForInvoiceId` abis
  // invoice-nya lahir (lockAndDeduct dipanggil SEBELUM invoice ada, jadi
  // id invoice belum bisa langsung ditulis di sini).
  reservedUnitIds?: string[];
```

- [ ] **Step 2: Tulis ulang test file dulu (TDD) — ganti 5 test kind=product**

Ganti seluruh `describe('StockLockingService.lockAndDeduct (kind=product)', ...)` (baris 17-97) jadi:

```typescript
describe('StockLockingService.lockAndDeduct (kind=product)', () => {
  it('FIFO pilih unit dari batch TERTUA dulu, harga jual dari Product.sellPrice, buyPrice = MAX batch berstok', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [
        { id: 'batch-lama', buy_price: '2900000' },
        { id: 'batch-baru', buy_price: '3100000' },
      ],
      [
        { id: 'unit-1', item_cost_id: 'batch-lama' },
        { id: 'unit-2', item_cost_id: 'batch-lama' },
        { id: 'unit-3', item_cost_id: 'batch-baru' },
      ],
    ]);

    const result = await service.lockAndDeduct(tx, 'product', 'produk-1', 3);

    expect(result).toEqual({
      name: 'AC Split 1PK',
      unit: 'unit',
      unitPrice: 3200000,
      buyPrice: 3100000, // MAX(2900000, 3100000) — bukan cuma batch yang kena FIFO
      batchDeductions: [
        { itemCostId: 'batch-lama', qty: 2 },
        { itemCostId: 'batch-baru', qty: 1 },
      ],
      reservedUnitIds: ['unit-1', 'unit-2', 'unit-3'],
    });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE stock_units SET status = 'reserved'"),
      ['unit-1', 'unit-2', 'unit-3'],
    );
  });

  it('buyPrice tetap MAX dari SEMUA batch berstok walau qty cuma abisin batch pertama', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [
        { id: 'batch-a', buy_price: '2900000' },
        { id: 'batch-b', buy_price: '3100000' },
      ],
      [{ id: 'unit-1', item_cost_id: 'batch-a' }],
    ]);

    const result = await service.lockAndDeduct(tx, 'product', 'produk-1', 1);

    expect(result.buyPrice).toBe(3100000);
    expect(result.batchDeductions).toEqual([{ itemCostId: 'batch-a', qty: 1 }]);
    expect(result.reservedUnitIds).toEqual(['unit-1']);
  });

  it('lempar BadRequestException kalau produk gak ketemu', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([[]]);
    await expect(service.lockAndDeduct(tx, 'product', 'produk-x', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lempar BadRequestException kalau produk nonaktif', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([[{ name: 'AC Split 1PK', active: false, sell_price: '3200000' }]]);
    await expect(service.lockAndDeduct(tx, 'product', 'produk-1', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lempar BadRequestException kalau gak ada batch berstok sama sekali', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [],
    ]);
    await expect(service.lockAndDeduct(tx, 'product', 'produk-1', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lempar BadRequestException kalau unit tersedia lebih sedikit dari qty diminta', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [{ id: 'batch-1', buy_price: '2900000' }],
      [{ id: 'unit-1', item_cost_id: 'batch-1' }],
    ]);
    await expect(service.lockAndDeduct(tx, 'product', 'produk-1', 5)).rejects.toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2b: Update `fakeTxSequence` helper comment** (baris 4-15) — ganti komentarnya jadi:
```typescript
// lockAndDeduct(kind='product') sekarang manggil $queryRawUnsafe 3x (query
// produk, query batch berstok buat MAX buyPrice, query pilih unit FIFO) —
// butuh hasil BERBEDA per panggilan berurutan.
```

- [ ] **Step 3: Jalanin test, pastiin FAIL** (implementasi belum diubah)

Run: `npm test -- stock-locking.service.spec.ts`
Expected: FAIL (query count/shape gak cocok sama implementasi lama)

- [ ] **Step 4: Ganti branch `kind === 'product'` di `lockAndDeduct`**

Ganti seluruh blok mulai `// kind === 'product' — FIFO lintas batch item_costs...` (baris 130) sampai akhir method (baris ~176) jadi:

```typescript
    // kind === 'product' — Siklus QR per-unit (2026-09-30): FIFO sekarang
    // pilih UNIT INDIVIDUAL (StockUnit), bukan decrement angka item_costs.
    // stock lagi (kolom itu dipensiunkan buat kind='product', lihat komentar
    // di schema.prisma model ItemCost). Status unit yang dipilih langsung
    // di-flip ke 'reserved' DI SINI (row udah kekunci FOR UPDATE) — belum
    // ditandain invoice mana, itu ditulis belakangan sama PosService.checkout
    // begitu invoice.id ada (lihat komentar reservedUnitIds di LockedItem).
    const productRows = await tx.$queryRawUnsafe<
      { name: string; active: boolean; sell_price: unknown }[]
    >(`SELECT name, active, sell_price FROM products WHERE id = $1`, refId);
    const product = productRows[0];
    if (!product) throw new BadRequestException(`Produk ${refId} tidak ditemukan`);
    if (!product.active) throw new BadRequestException(`${product.name} tidak aktif`);

    // MAX(buyPrice) dari SEMUA batch yang MASIH ADA unit 'di_gudang' —
    // skenario "harga modal TERMAHAL" buat warning below-cost (keputusan
    // user 2026-09-22), gak peduli batch itu kena FIFO consume di bawah atau
    // enggak — SAMA prinsip kayak sebelumnya, cuma sumber datanya sekarang
    // dicek lewat EXISTS ke stock_units, bukan kolom stock langsung.
    const batches = await tx.$queryRawUnsafe<{ id: string; buy_price: unknown }[]>(
      `SELECT ic.id, ic.buy_price FROM item_costs ic
       WHERE ic.kind = 'product' AND ic.ref_id = $1
         AND EXISTS (SELECT 1 FROM stock_units su WHERE su.item_cost_id = ic.id AND su.status = 'di_gudang')
       ORDER BY ic.id FOR UPDATE`,
      refId,
    );
    if (batches.length === 0) {
      throw new BadRequestException(`Stok ${product.name} tidak cukup`);
    }
    const maxBuyPrice = Math.max(...batches.map((b) => Number(b.buy_price)));

    // FIFO beneran — `qty` unit TERTUA (urut created_at batch dulu, baru
    // created_at unit dalam batch itu), row-locked biar checkout paralel gak
    // bisa rebutan unit yang sama.
    const availableUnits = await tx.$queryRawUnsafe<{ id: string; item_cost_id: string }[]>(
      `SELECT su.id, su.item_cost_id
       FROM stock_units su
       JOIN item_costs ic ON ic.id = su.item_cost_id
       WHERE su.ref_id = $1 AND su.status = 'di_gudang'
       ORDER BY ic.created_at ASC, su.created_at ASC
       LIMIT $2
       FOR UPDATE OF su`,
      refId,
      qty,
    );
    if (availableUnits.length < qty) {
      throw new BadRequestException(`Stok ${product.name} tidak cukup`);
    }

    const batchQtyMap = new Map<string, number>();
    for (const u of availableUnits) {
      batchQtyMap.set(u.item_cost_id, (batchQtyMap.get(u.item_cost_id) ?? 0) + 1);
    }
    const batchDeductions = [...batchQtyMap].map(([itemCostId, qty]) => ({ itemCostId, qty }));
    const reservedUnitIds = availableUnits.map((u) => u.id);

    await tx.$executeRawUnsafe(
      `UPDATE stock_units SET status = 'reserved', reserved_at = now() WHERE id = ANY($1)`,
      reservedUnitIds,
    );

    return {
      name: product.name,
      unit: 'unit',
      unitPrice: Number(product.sell_price),
      buyPrice: maxBuyPrice,
      batchDeductions,
      reservedUnitIds,
    };
  }
```

- [ ] **Step 5: Jalanin test lagi, pastiin PASS**

Run: `npm test -- stock-locking.service.spec.ts`
Expected: PASS (semua test kind=product & kind=sparepart — sparepart gak kesentuh sama sekali)

- [ ] **Step 6: Commit**

```bash
git add src/common/services/stock-locking.service.ts src/common/services/stock-locking.service.spec.ts
git commit -m "feat(stock-locking): produk reservasi StockUnit FIFO, bukan decrement angka (Siklus QR per-unit)"
```

---

## Task 3: `StockService.stockIn` — generate `StockUnit` per unit fisik + blokir opname produk per-batch

**Files:**
- Modify: `src/stock/stock.service.ts`

- [ ] **Step 1: Inject `CountersService`**

Tambah import & constructor param:
```typescript
import { CountersService } from '../counters/counters.service';
```
```typescript
  constructor(
    private prisma: PrismaService,
    private stockLocking: StockLockingService,
    private counters: CountersService,
  ) {}
```
(`CountersModule` @Global(), gak perlu diimport di `stock.module.ts`.)

- [ ] **Step 2: Tambah helper `generateStockUnits` (private method, taruh sebelum `stockIn`)**

```typescript
  /**
   * BARU (Siklus QR per-unit, 2026-09-30) — bikin `qty` baris StockUnit buat
   * 1 batch (ItemCost kind='product') yang baru dibuat. Loop 1-per-1 (bukan
   * createMany) SENGAJA — butuh id/unitCode/qrToken tiap baris buat
   * dibalikin (dipakai cetak label langsung abis stock-in kalau perlu), dan
   * qty per barang-masuk normalnya kecil (satuan/puluhan unit AC, bukan
   * ribuan), jadi N query gak masalah performa.
   */
  private async generateStockUnits(
    tx: Prisma.TransactionClient,
    itemCostId: string,
    refId: string,
    sku: string | null,
    qty: number,
  ) {
    const created: { id: string; unitCode: string; qrToken: string }[] = [];
    for (let i = 0; i < qty; i++) {
      const seq = await this.counters.nextSeq(tx, `stock_unit_${refId}`);
      const unitCode = `${sku ?? refId.slice(0, 8)}-U${String(seq).padStart(4, '0')}`;
      const unit = await tx.stockUnit.create({
        data: {
          itemCostId,
          refId,
          unitCode,
          qrToken: randomUUID(),
          status: 'di_gudang',
        },
      });
      created.push({ id: unit.id, unitCode: unit.unitCode, qrToken: unit.qrToken });
    }
    return created;
  }
```

`Prisma` namespace udah diimport (dipakai `Prisma.InputJsonValue` kalau ada — cek; kalau belum ada import `Prisma` dari `@prisma/client`, tambahkan `import { Prisma } from '@prisma/client';` di atas).

- [ ] **Step 3: Panggil `generateStockUnits` di branch `pairMode === 'lengkap'`**

Setelah `const indoorBatch = await tx.itemCost.create({... stock: dto.qty ...});` DAN sebelum `await tx.stockMovement.create(...)` buat indoor, ganti `stock: dto.qty` jadi `stock: 0` (placeholder — StockUnit yang sekarang nyimpen jumlah beneran) lalu tambah panggilan generate:

```typescript
          const indoorBatch = await tx.itemCost.create({
            data: { kind: 'product', refId: dto.refId, supplierName: dto.supplierName, buyPrice: dto.buyPrice, sellPrice: 0, stock: 0 },
          });
          await this.generateStockUnits(tx, indoorBatch.id, dto.refId, indoorProduct.sku, dto.qty);
          await tx.stockMovement.create({
            data: { itemKind: 'product', refId: dto.refId, name: indoorProduct.name, qtyChange: dto.qty, reason: 'barang_masuk', createdById: actorId, itemCostId: indoorBatch.id, pairGroupId },
          });

          const outdoorBatch = await tx.itemCost.create({
            data: { kind: 'product', refId: dto.outdoorRefId, supplierName: dto.supplierName, buyPrice: 0, sellPrice: 0, stock: 0 },
          });
          await this.generateStockUnits(tx, outdoorBatch.id, dto.outdoorRefId, outdoorProduct.sku, dto.qty);
          await tx.stockMovement.create({
            data: { itemKind: 'product', refId: dto.outdoorRefId, name: outdoorProduct.name, qtyChange: dto.qty, reason: 'barang_masuk', createdById: actorId, itemCostId: outdoorBatch.id, pairGroupId },
          });
```

(`StockMovement` TETAP ditulis apa adanya — itu histori mutasi/laporan, gak berubah. Yang berubah cuma `item_costs.stock` berhenti jadi sumber "stok tersedia" beneran.)

- [ ] **Step 4: Panggil `generateStockUnits` di branch produk tunggal (bukan `pairMode='lengkap'`)**

Ganti:
```typescript
        const batch = await tx.itemCost.create({
          data: {
            kind: 'product',
            refId: dto.refId,
            supplierName: dto.supplierName,
            buyPrice: dto.buyPrice,
            sellPrice: 0,
            stock: dto.qty,
          },
        });
```
jadi:
```typescript
        const batch = await tx.itemCost.create({
          data: {
            kind: 'product',
            refId: dto.refId,
            supplierName: dto.supplierName,
            buyPrice: dto.buyPrice,
            sellPrice: 0,
            stock: 0, // placeholder — StockUnit di bawah yang nyimpen jumlah beneran (Siklus QR per-unit)
          },
        });
        await this.generateStockUnits(tx, batch.id, dto.refId, product.sku, dto.qty);
```

- [ ] **Step 5: Tambah method publik `findUnitsByBatch` (dipakai halaman cetak label, Task 4)**

Taruh setelah `opname()`:
```typescript
  /** Daftar unit fisik (StockUnit) 1 batch — dipakai cetak/cetak-ulang label
   * QR (halaman /stock/batches/:itemCostId/print-labels). */
  async findUnitsByBatch(itemCostId: string) {
    return this.prisma.stockUnit.findMany({
      where: { itemCostId },
      select: { id: true, unitCode: true, qrToken: true },
      orderBy: { createdAt: 'asc' },
    });
  }
```

- [ ] **Step 6: Blokir `opname` buat `kind='product'` (kolom yang dikoreksinya udah pensiun)**

Di method `opname`, pada bagian `// kind === 'product', ATAU kind === 'sparepart' dengan itemCostId...` — tambah guard PALING ATAS blok itu (sebelum baris `if (!item.itemCostId) { throw ... }`):

```typescript
        // Siklus QR per-unit (2026-09-30) — item_costs.stock UDAH GAK
        // dipakai lagi buat kind='product' (StockUnit yang sekarang jadi
        // sumber kebenaran), jadi opname per-batch produk di sini gak lagi
        // valid — mengoreksi kolom yang gak dibaca siapa pun. Opname per-unit
        // (misal tandain 1 StockUnit 'hilang'/'rusak') sengaja BELUM
        // dibangun (out of scope spec 2026-09-30), diblokir eksplisit di
        // sini biar gak diam-diam jadi no-op yang bikin bingung.
        if (item.kind === 'product') {
          throw new BadRequestException(
            'Opname produk per-unit belum didukung — fitur stok per-unit fisik belum sampai ke opname',
          );
        }
```

- [ ] **Step 7: Commit**

```bash
git add src/stock/stock.service.ts
git commit -m "feat(stock): stockIn generate StockUnit per unit fisik, blokir opname produk (Siklus QR per-unit)"
```

---

## Task 4: `StockController` — endpoint cetak/cetak-ulang label

**Files:**
- Modify: `src/stock/stock.controller.ts`

- [ ] **Step 1: Tambah `Param` ke import & endpoint baru**

```typescript
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
```

Tambah method (setelah `findMovements`):
```typescript
  // BARU (Siklus QR per-unit, 2026-09-30) — daftar unit fisik 1 batch, buat
  // halaman cetak/cetak-ulang label QR (frontend Task 9).
  @Get('batches/:itemCostId/units')
  findUnitsByBatch(@Param('itemCostId') itemCostId: string) {
    return this.stockService.findUnitsByBatch(itemCostId);
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/stock/stock.controller.ts
git commit -m "feat(stock): endpoint GET /stock/batches/:itemCostId/units buat cetak label"
```

---

## Task 5: `ProductsService.stockFor` — hitung dari `StockUnit`, bukan `SUM(item_costs.stock)`

**Files:**
- Modify: `src/products/products.service.ts`

- [ ] **Step 1: Ganti isi method `stockFor`**

```typescript
  /** Stok Produk SEKARANG dihitung dari StockUnit (status='di_gudang' =
   * tersedia) — Siklus QR per-unit (2026-09-30), gantiin SUM(item_costs.
   * stock) lama. 'reserved' (udah dikunci ke 1 invoice pas checkout) &
   * 'keluar' (udah beneran pergi dari gudang) SENGAJA gak keitung tersedia.
   * Harga jual TETAP kolom langsung di Product (Siklus harga-seragam
   * 2026-09-22), gak berubah. */
  private async stockFor(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ ref_id: string; total_stock: string }[]>`
      SELECT ref_id, COUNT(*) AS total_stock
      FROM stock_units
      WHERE status = 'di_gudang' AND ref_id = ANY(${productIds})
      GROUP BY ref_id
    `;
    return new Map(rows.map((r) => [r.ref_id, Number(r.total_stock)]));
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/products/products.service.ts
git commit -m "feat(products): stockFor hitung dari StockUnit (Siklus QR per-unit)"
```

---

## Task 6: `PosService.checkout` — tandain `reservedForInvoiceId` abis invoice lahir

**Files:**
- Modify: `src/pos/pos.service.ts`

- [ ] **Step 1: Tambah blok setelah `const invoice = await tx.invoice.create({...});`**

Taruh PERSIS setelah blok `tx.invoice.create` (sebelum loop `for (const item of dto.items) { ... tx.invoiceItem.create ... }`):

```typescript
        // Siklus QR per-unit (2026-09-30) — StockLockingService udah
        // mereservasi StockUnit yang relevan (status='reserved') pas lock
        // stok di atas, TAPI belum tau invoice mana yang mereservasi (invoice
        // ini baru aja lahir). Tandain di sini, SEKALI, gabungan dari SEMUA
        // baris produk (termasuk pasangan Indoor+Outdoor mode Lengkap — dua-
        // duanya sama-sama nyumbang reservedUnitIds sendiri-sendiri).
        const allReservedUnitIds = [...stockResults.values()].flatMap((r) => r.reservedUnitIds ?? []);
        if (allReservedUnitIds.length > 0) {
          await tx.stockUnit.updateMany({
            where: { id: { in: allReservedUnitIds } },
            data: { reservedForInvoiceId: invoice.id },
          });
        }
```

- [ ] **Step 2: Commit**

```bash
git add src/pos/pos.service.ts
git commit -m "feat(pos): tandain StockUnit reserved dengan invoiceId abis checkout (Siklus QR per-unit)"
```

---

## Task 7: Module baru `KasirScan` — scan/ceklist manual buat fulfillment

**Files:**
- Create: `src/kasir-scan/dto/scan-unit.dto.ts`
- Create: `src/kasir-scan/dto/manual-fulfill.dto.ts`
- Create: `src/kasir-scan/kasir-scan.service.ts`
- Create: `src/kasir-scan/kasir-scan.controller.ts`
- Create: `src/kasir-scan/kasir-scan.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: DTO**

`src/kasir-scan/dto/scan-unit.dto.ts`:
```typescript
import { IsNotEmpty, IsString } from 'class-validator';

export class ScanUnitDto {
  @IsString() @IsNotEmpty() invoiceId: string;
  @IsString() @IsNotEmpty() qrToken: string;
}
```

`src/kasir-scan/dto/manual-fulfill.dto.ts`:
```typescript
import { IsNotEmpty, IsString } from 'class-validator';

export class ManualFulfillDto {
  @IsString() @IsNotEmpty() invoiceId: string;
  @IsString() @IsNotEmpty() refId: string;
}
```

- [ ] **Step 2: Service**

`src/kasir-scan/kasir-scan.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScanUnitDto } from './dto/scan-unit.dto';
import { ManualFulfillDto } from './dto/manual-fulfill.dto';

/**
 * Siklus QR per-unit (2026-09-30) — "Kasir Scan". Checkout POS gak lagi
 * langsung ngeluarin stok Produk secara fisik: dia cuma REZERVASI unit
 * (StockUnit.status='reserved', ditandain invoiceId-nya — lihat
 * PosService.checkout & StockLockingService.lockAndDeduct). Modul ini
 * ngurus tahap KEDUA — konfirmasi fisik unit mana yang beneran keluar dari
 * gudang, lewat scan QR (kamera) atau ceklist manual (fallback kalau QR
 * rusak/gak kebaca). BARU di titik INI stok resmi "abis" (status 'keluar').
 */
@Injectable()
export class KasirScanService {
  constructor(private readonly prisma: PrismaService) {}

  /** Daftar invoice yang masih punya unit 'reserved' (belum full di-scan/ceklist). */
  async listPending() {
    const rows = await this.prisma.$queryRaw<
      { invoice_id: string; number: string; customer_name: string | null; created_at: Date; pending_lines: bigint }[]
    >`
      SELECT i.id AS invoice_id, i.number, i.customer_name, i.created_at,
             COUNT(DISTINCT su.ref_id) AS pending_lines
      FROM stock_units su
      JOIN invoices i ON i.id = su.reserved_for_invoice_id
      WHERE su.status = 'reserved'
      GROUP BY i.id, i.number, i.customer_name, i.created_at
      ORDER BY i.created_at ASC
    `;
    return rows.map((r) => ({
      invoiceId: r.invoice_id,
      invoiceNumber: r.number,
      customerName: r.customer_name,
      createdAt: r.created_at,
      pendingLines: Number(r.pending_lines),
    }));
  }

  /** Detail 1 invoice — per baris produk: qtyTotal (jumlah unit yang
   * direservasi pas checkout), qtyFulfilled (udah discan/diceklist),
   * qtyRemaining. Baris qtyRemaining=0 gak perlu discan lagi. */
  async getInvoiceFulfillment(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice tidak ditemukan');

    const rows = await this.prisma.$queryRaw<
      { ref_id: string; product_name: string; qty_total: bigint; qty_fulfilled: bigint }[]
    >`
      SELECT su.ref_id, p.name AS product_name,
             COUNT(*) AS qty_total,
             COUNT(*) FILTER (WHERE su.status = 'keluar') AS qty_fulfilled
      FROM stock_units su
      JOIN products p ON p.id = su.ref_id
      WHERE su.reserved_for_invoice_id = ${invoiceId}
      GROUP BY su.ref_id, p.name
      ORDER BY p.name ASC
    `;

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      customerName: invoice.customerName,
      lines: rows.map((r) => ({
        refId: r.ref_id,
        productName: r.product_name,
        qtyTotal: Number(r.qty_total),
        qtyFulfilled: Number(r.qty_fulfilled),
        qtyRemaining: Number(r.qty_total) - Number(r.qty_fulfilled),
      })),
    };
  }

  /** Scan QR fisik — token dicari langsung, gak perlu milih baris dulu (itu
   * yang bikin scan lebih cepet daripada ceklist manual). */
  async scanUnit(dto: ScanUnitDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.stockUnit.findUnique({ where: { qrToken: dto.qrToken } });
      if (!unit) throw new BadRequestException('QR ini gak dikenali sistem');
      return this.fulfillUnit(tx, unit.id, dto.invoiceId, actorId, 'scan');
    });
  }

  /** Fallback manual — gak butuh tau unit spesifik, sistem ambil 1 unit
   * 'reserved' TERTUA buat (invoice, refId) itu (FIFO, sama prinsip kayak
   * StockLockingService). */
  async manualFulfill(dto: ManualFulfillDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM stock_units
         WHERE reserved_for_invoice_id = $1 AND ref_id = $2 AND status = 'reserved'
         ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
        dto.invoiceId,
        dto.refId,
      );
      const unit = rows[0];
      if (!unit) {
        throw new BadRequestException('Gak ada unit tersisa yang perlu dikeluarin buat baris ini');
      }
      return this.fulfillUnit(tx, unit.id, dto.invoiceId, actorId, 'manual');
    });
  }

  private async fulfillUnit(
    tx: Prisma.TransactionClient,
    stockUnitId: string,
    invoiceId: string,
    actorId: string,
    method: 'scan' | 'manual',
  ) {
    const rows = await tx.$queryRawUnsafe<
      { id: string; ref_id: string; status: string; reserved_for_invoice_id: string | null }[]
    >(
      `SELECT id, ref_id, status, reserved_for_invoice_id FROM stock_units WHERE id = $1 FOR UPDATE`,
      stockUnitId,
    );
    const unit = rows[0];
    if (!unit) throw new BadRequestException('Unit tidak ditemukan');
    if (unit.reserved_for_invoice_id !== invoiceId) {
      throw new BadRequestException('Unit ini bukan bagian dari invoice ini');
    }
    if (unit.status === 'keluar') {
      throw new BadRequestException('Unit ini udah pernah dikeluarkan sebelumnya');
    }
    if (unit.status !== 'reserved') {
      throw new BadRequestException('Unit ini belum direservasi buat invoice manapun');
    }

    await tx.stockUnit.update({
      where: { id: unit.id },
      data: { status: 'keluar', soldAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'kasir_scan.fulfill',
        target: unit.id,
        detail: { invoiceId, refId: unit.ref_id, method },
      },
    });

    return { status: 'ok' as const, refId: unit.ref_id, stockUnitId: unit.id };
  }
}
```

- [ ] **Step 3: Controller**

`src/kasir-scan/kasir-scan.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { KasirScanService } from './kasir-scan.service';
import { ScanUnitDto } from './dto/scan-unit.dto';
import { ManualFulfillDto } from './dto/manual-fulfill.dto';

// Admin + kasir — sama pembatasan kayak checkout POS (StockController/
// stock-in tetap admin-only, tapi ngeluarin barang abis invoice terbit ini
// pekerjaan kasir/gudang sehari-hari).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'kasir')
@Controller('kasir-scan')
export class KasirScanController {
  constructor(private readonly kasirScan: KasirScanService) {}

  @Get('pending')
  listPending() {
    return this.kasirScan.listPending();
  }

  @Get('invoices/:invoiceId')
  getInvoice(@Param('invoiceId') invoiceId: string) {
    return this.kasirScan.getInvoiceFulfillment(invoiceId);
  }

  @Post('scan')
  scan(@Body() dto: ScanUnitDto, @CurrentUser() user: CurrentUserPayload) {
    return this.kasirScan.scanUnit(dto, user.sub);
  }

  @Post('manual-fulfill')
  manualFulfill(@Body() dto: ManualFulfillDto, @CurrentUser() user: CurrentUserPayload) {
    return this.kasirScan.manualFulfill(dto, user.sub);
  }
}
```

- [ ] **Step 4: Module**

`src/kasir-scan/kasir-scan.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { KasirScanService } from './kasir-scan.service';
import { KasirScanController } from './kasir-scan.controller';

@Module({
  controllers: [KasirScanController],
  providers: [KasirScanService],
})
export class KasirScanModule {}
```

- [ ] **Step 5: Register di `app.module.ts`**

Tambah import:
```typescript
import { KasirScanModule } from './kasir-scan/kasir-scan.module';
```
Tambah ke array `imports` (setelah `SystemResetModule`):
```typescript
    KasirScanModule,
```

- [ ] **Step 6: Commit**

```bash
git add src/kasir-scan src/app.module.ts
git commit -m "feat(kasir-scan): modul baru — scan QR/ceklist manual buat fulfillment unit stok"
```

---

## Task 8: Frontend — halaman cetak label QR unit stok

**Files:**
- Create: `src/app/(dashboard)/stock/batches/[itemCostId]/print-labels/page.tsx`
- Create: `src/app/(dashboard)/stock/batches/[itemCostId]/print-labels/stock-unit-labels-print-client.tsx`

Reuse `BarcodeQr` (`@/components/barcode-qr`) — komponen QR yang SAMA udah dipakai buat label unit AC customer (`unit-labels-print-client.tsx`), jadi cara cetak/`window.print()`/CSS `@page` mengikuti pola yang udah ada persis.

- [ ] **Step 1: Page (server component, auth gate)**

`src/app/(dashboard)/stock/batches/[itemCostId]/print-labels/page.tsx`:
```tsx
import { requireSession } from '@/lib/server-api';
import { StockUnitLabelsPrintClient } from './stock-unit-labels-print-client';

export default async function StockUnitLabelsPrintPage({
  params,
}: {
  params: Promise<{ itemCostId: string }>;
}) {
  const { itemCostId } = await params;
  await requireSession();
  return <StockUnitLabelsPrintClient itemCostId={itemCostId} />;
}
```

- [ ] **Step 2: Client component**

`src/app/(dashboard)/stock/batches/[itemCostId]/print-labels/stock-unit-labels-print-client.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { BarcodeQr } from '@/components/barcode-qr';
import { Button } from '@/components/ui/button';

interface StockUnitLabel {
  id: string;
  unitCode: string;
  qrToken: string;
}

// Padanan unit-labels-print-client.tsx (label unit AC customer), TAPI buat
// unit FISIK di GUDANG (Siklus QR per-unit, 2026-09-30) — dicetak abis
// Barang Masuk, atau dicetak ULANG dari sini kapan aja (misal buat stok lama
// yang di-backfill migration, belum pernah punya label fisik tertempel).
export function StockUnitLabelsPrintClient({ itemCostId }: { itemCostId: string }) {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stock', 'batches', itemCostId, 'units'],
    queryFn: () => apiClient.get<StockUnitLabel[]>(`/stock/batches/${itemCostId}/units`),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat label unit...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat label unit.</p>;

  if (data.length === 0) {
    return (
      <div className="p-6">
        <Button variant="ghost" className="mb-4" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <p className="text-sm text-muted-foreground">Batch ini gak punya unit buat dicetak labelnya.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Lebih kecil dari label unit AC customer (105x148mm) — ini ditempel
          ke dus/unit di gudang, bukan dibawa teknisi, jadi 1 halaman muat
          beberapa label sekaligus. */}
      <style>{'@page { size: 70mm 50mm; margin: 3mm; }'}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          Kembali
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak {data.length > 1 ? `${data.length} Label` : 'Label'}
        </Button>
      </div>

      <div className="bg-white text-black">
        {data.map((unit, i) => (
          <div
            key={unit.id}
            className="flex min-h-[44mm] flex-col items-center justify-center gap-1 text-center"
            style={i < data.length - 1 ? { breakAfter: 'page' } : undefined}
          >
            <BarcodeQr value={unit.qrToken} size={64} />
            <p className="text-xs">{unit.unitCode}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/stock/batches"
git commit -m "feat(stock): halaman cetak label QR unit stok"
```

---

## Task 9: Frontend — hook "Cetak Label" ke alur Barang Masuk produk

**Files:**
- Modify: `src/app/(dashboard)/stock/stock-client.tsx`

- [ ] **Step 1: Baca `stock-client.tsx`, cari `onSuccess` mutation `stockIn`**

File ini 845 baris, belum kebaca di riset plan ini — LANGKAH PERTAMA task ini WAJIB baca dulu (`Read` tool) sebelum edit, cari handler `onSuccess` dari mutation yang manggil `POST /stock/in` (biasanya nampilin toast sukses).

- [ ] **Step 2: Tambah tombol "Cetak Label" di toast/dialog sukses (khusus `kind==='product'`)**

Response `stockIn` (`status:'ok', kind:'product', batchId, ..., pairGroupId?, outdoorBatchId?`) UDAH punya `batchId` (dan `outdoorBatchId` kalau mode Lengkap) — cukup navigasi ke halaman print yang baru dibuat Task 8, TANPA butuh perubahan response backend. Pola konkret (sesuaikan ke struktur asli onSuccess yang ditemukan di Step 1, misal pakai `sonner` toast dengan action button, atau tambahan tombol di dialog konfirmasi sukses):

```tsx
import { useRouter } from 'next/navigation';
// ...
const router = useRouter();
// di dalam onSuccess stockIn mutation, kalau result.status === 'ok' && result.kind === 'product':
toast.success(`Barang masuk tercatat — ${result.qty} unit ${result.name}`, {
  action: {
    label: 'Cetak Label',
    onClick: () => router.push(`/stock/batches/${result.batchId}/print-labels`),
  },
});
if (result.outdoorBatchId) {
  toast.success('Outdoor juga tercatat', {
    action: {
      label: 'Cetak Label Outdoor',
      onClick: () => router.push(`/stock/batches/${result.outdoorBatchId}/print-labels`),
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/stock/stock-client.tsx
git commit -m "feat(stock): tombol cetak label abis barang masuk produk"
```

---

## Task 10: Frontend — halaman baru "Kasir Scan"

**Files:**
- Create: `src/app/(dashboard)/kasir-scan/page.tsx`
- Create: `src/app/(dashboard)/kasir-scan/kasir-scan-client.tsx`

Reuse `BarcodeScanner` (`@/components/barcode-scanner`) apa adanya — komponen 3-mode (manual/kamera/upload) yang udah ada, udah daftar `QR_CODE` di `SUPPORTED_FORMATS`-nya, jadi gak ada perubahan apapun di komponen itu.

- [ ] **Step 1: Page**

`src/app/(dashboard)/kasir-scan/page.tsx`:
```tsx
import { requireSession } from '@/lib/server-api';
import { KasirScanClient } from './kasir-scan-client';

export default async function KasirScanPage() {
  await requireSession();
  return <KasirScanClient />;
}
```

- [ ] **Step 2: Client component**

`src/app/(dashboard)/kasir-scan/kasir-scan-client.tsx`:
```tsx
'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PendingInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string | null;
  createdAt: string;
  pendingLines: number;
}

interface FulfillmentLine {
  refId: string;
  productName: string;
  qtyTotal: number;
  qtyFulfilled: number;
  qtyRemaining: number;
}

interface InvoiceFulfillment {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string | null;
  lines: FulfillmentLine[];
}

// Tahap KEDUA checkout (Siklus QR per-unit, 2026-09-30) — invoice udah
// terbit/dibayar di POS, halaman ini buat konfirmasi FISIK unit mana yang
// beneran keluar dari gudang (scan QR kamera atau ceklist manual). Biasanya
// dibuka dari device KEDUA (HP/tablet gudang), login akun yang sama/beda
// (JWT stateless, sesi ganda otomatis kesupport, gak butuh perubahan auth).
export function KasirScanClient() {
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

  const pendingQuery = useQuery({
    queryKey: ['kasir-scan', 'pending'],
    queryFn: () => apiClient.get<PendingInvoice[]>('/kasir-scan/pending'),
    enabled: !selectedInvoiceId,
  });

  const invoiceQuery = useQuery({
    queryKey: ['kasir-scan', 'invoice', selectedInvoiceId],
    queryFn: () => apiClient.get<InvoiceFulfillment>(`/kasir-scan/invoices/${selectedInvoiceId}`),
    enabled: !!selectedInvoiceId,
  });

  function refreshAfterFulfill() {
    void queryClient.invalidateQueries({ queryKey: ['kasir-scan', 'invoice', selectedInvoiceId] });
    void queryClient.invalidateQueries({ queryKey: ['kasir-scan', 'pending'] });
  }

  const scanMutation = useMutation({
    mutationFn: (qrToken: string) =>
      apiClient.post('/kasir-scan/scan', { invoiceId: selectedInvoiceId, qrToken }),
    onSuccess: () => {
      toast.success('Unit berhasil ditandai keluar');
      refreshAfterFulfill();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal memproses scan');
    },
  });

  const manualMutation = useMutation({
    mutationFn: (refId: string) =>
      apiClient.post('/kasir-scan/manual-fulfill', { invoiceId: selectedInvoiceId, refId }),
    onSuccess: () => {
      toast.success('Unit ditandai keluar (manual)');
      refreshAfterFulfill();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menandai manual');
    },
  });

  if (!selectedInvoiceId) {
    return (
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kasir Scan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Konfirmasi unit fisik yang beneran keluar dari gudang buat invoice yang udah checkout.
          </p>
        </div>
        {pendingQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
        {pendingQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Gak ada invoice yang masih nunggu fulfillment.</p>
        )}
        <div className="grid gap-3">
          {pendingQuery.data?.map((inv) => (
            <Card
              key={inv.invoiceId}
              className="cursor-pointer transition-colors hover:bg-accent"
              onClick={() => setSelectedInvoiceId(inv.invoiceId)}
            >
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{inv.invoiceNumber}</p>
                  <p className="text-sm text-muted-foreground">{inv.customerName ?? '-'}</p>
                </div>
                <p className="text-sm text-muted-foreground">{inv.pendingLines} baris belum keluar</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const data = invoiceQuery.data;
  const remainingLines = data?.lines.filter((l) => l.qtyRemaining > 0) ?? [];
  const allDone = !!data && remainingLines.length === 0;

  return (
    <div className="grid gap-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => setSelectedInvoiceId(null)}>
          <ArrowLeft className="size-4" />
          Kembali ke daftar
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{data?.invoiceNumber ?? '...'}</h1>
        <p className="text-sm text-muted-foreground">{data?.customerName ?? '-'}</p>
      </div>

      {allDone ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm">
            <CheckCircle2 className="size-5 text-green-600" />
            Semua unit di invoice ini udah keluar dari gudang.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan Unit</CardTitle>
          </CardHeader>
          <CardContent>
            <BarcodeScanner
              onDetect={(code) => scanMutation.mutate(code)}
              manualPlaceholder="Tempel/ketik QR token unit"
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {data?.lines.map((line) => (
          <Card key={line.refId}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{line.productName}</p>
                <p className="text-sm text-muted-foreground">
                  {line.qtyFulfilled}/{line.qtyTotal} unit udah keluar
                </p>
              </div>
              {line.qtyRemaining > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={manualMutation.isPending}
                  onClick={() => manualMutation.mutate(line.refId)}
                >
                  Ceklist Manual
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/kasir-scan"
git commit -m "feat(kasir-scan): halaman Kasir Scan — scan kamera + ceklist manual"
```

---

## Task 11: Frontend — nav & role gate

**Files:**
- Modify: `src/app/(dashboard)/_components/nav-config.ts`
- Modify: `proxy.ts`

- [ ] **Step 1: Tambah nav item admin & kasir**

Import icon baru (`ScanLine` udah diimport buat teknisi — reuse):
Di `NAV_BY_ROLE.admin`, tambah leaf baru di grup `Transaksi` (setelah `'/pos'`):
```typescript
        { href: '/kasir-scan', label: 'Kasir Scan', icon: ScanLine },
```
Di `NAV_BY_ROLE.kasir`, tambah setelah `'/pos'`:
```typescript
    { href: '/kasir-scan', label: 'Kasir Scan', icon: ScanLine },
```

- [ ] **Step 2: Role gate di `proxy.ts`**

Tambah ke `ROLE_PREFIXES` (setelah `'/pos'`):
```typescript
  { prefix: '/kasir-scan', roles: ['kasir', 'admin'] },
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/_components/nav-config.ts" proxy.ts
git commit -m "feat(nav): daftarin halaman Kasir Scan di nav admin+kasir & role gate"
```

---

## Manual steps (setelah semua task selesai, dijalanin user di device — sandbox gak punya DB live)

1. `npx prisma migrate deploy` (atau `prisma migrate dev` di lingkungan dev) — bikin tabel `stock_units` + jalanin backfill.
2. `npx prisma generate` — regenerate Prisma Client (`tx.stockUnit`, dst).
3. Restart backend (Nest) & rebuild frontend (Next.js) biar route baru (`/kasir-scan`, `/stock/batches/[itemCostId]/print-labels`) kebaca.
4. Cek hasil backfill: buka Master Data > Produk yang udah ada stoknya dari sebelum fitur ini, coba "Cetak Label" — pastiin jumlah unit yang muncul cocok sama stok yang keliatan sekarang.
5. **Out of scope, dicatet buat nanti (bukan bug):** opname produk per-batch sekarang diblokir (Task 3 Step 6) — kalau butuh koreksi stok fisik produk sebelum fitur opname-per-unit dibangun, koreksi manual lewat SQL/psql langsung ke tabel `stock_units` (ubah `status`).
