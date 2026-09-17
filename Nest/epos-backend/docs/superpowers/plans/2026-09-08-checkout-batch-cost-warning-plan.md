# Warning Harga Jual di Bawah Modal (Batch Cost) — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti `item_costs` dari "1 nilai harga modal per produk" jadi tabel batch (banyak baris per produk, masing-masing punya harga modal+jual+stok sendiri), lalu pakai itu buat ngasih warning real-time (soft-warn + confirm, bukan blokir keras) kalau harga jual efektif di checkout ATAU barang masuk ada di bawah/pas modal batch itu.

**Architecture:** Prisma schema migration mindah `sellPrice`/`stock` dari `Product` ke `ItemCost` (direstruktur jadi tabel batch, PK `id` bukan lagi `[kind,refId]`). `StockLockingService` dipecah jadi 2 jalur lock buat `kind='product'`: FIFO otomatis (dipakai `MaterialRequestsService`, gak berubah dari sisi caller) dan pilih-batch-manual (dipakai `PosService.checkout`, kasir yang milih). Warning "di bawah modal" dideteksi di dalam `$transaction` lewat util murni `checkBelowCost()`, dan kalau kena + belum ada konfirmasi, transaksi di-abort pakai custom `ConfirmationRequiredException` yang ditangkep DI LUAR `$transaction` biar responsnya tetep HTTP 200 (bukan error) berisi daftar warning. `sparepart` TIDAK kena semua perubahan ini — tetep 1 harga simpel kayak sekarang.

**Tech Stack:** NestJS 11, Prisma 7 (raw SQL `$queryRawUnsafe`/`$executeRawUnsafe` buat row-locking `FOR UPDATE`), PostgreSQL, class-validator, Jest.

**Scope:** Backend doang (`epos-backend`). Frontend POS (dialog pemilihan batch, dialog konfirmasi warning) itu plan TERPISAH setelah plan ini selesai & API-nya stabil — spec lengkap ada di `docs/superpowers/specs/2026-09-08-checkout-batch-cost-warning-design.md`, bagian FE-nya (§8) jadi acuan buat plan itu nanti.

---

## Ringkasan Perubahan Skema

| Sebelum | Sesudah |
|---|---|
| `products.sell_price`, `products.stock` | **Dihapus** — pindah ke `item_costs` |
| `item_costs` PK `[kind, ref_id]` (1 baris/produk) | PK `id` sendiri, boleh banyak baris per `(kind, ref_id)` buat `kind='product'` |
| `item_costs` cuma `buy_price` | Tambah `sell_price`, `stock`, `supplier_name`, `created_at` |
| `transaction_items`/`invoice_items` gak ada diskon per-baris | Tambah kolom `discount` |
| `stock_movements` gak nunjuk batch spesifik | Tambah `item_cost_id` (nullable) |

`sparepart` TIDAK kena restrukturisasi PK — di kode tetep dijaga cuma 1 baris per `refId` (upsert), `sellPrice`/`stock` sparepart TETAP di tabel `spareparts` sendiri (gak pindah).

---

### Task 1: Migrasi Skema Database

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260908000000_batch_cost_tracking/migration.sql`

- [ ] **Step 1: Edit model `Product` — hapus `sellPrice` & `stock`**

Di `prisma/schema.prisma`, cari model `Product` (sekitar baris 279 kalau dihitung dari model `Transaction` di summary — cari literal `model Product {`). Hapus 2 baris ini dari dalamnya:
```prisma
  sellPrice   Decimal  @map("sell_price") @db.Decimal(14, 2)
  stock       Int      @default(0)
```
Tambahkan komentar di atas field `photoUrl` (field pertama setelah yang dihapus) biar jelas kenapa:
```prisma
  // sellPrice & stock DIHAPUS dari sini (Siklus batch-cost 2026-09) —
  // pindah ke ItemCost, 1 produk sekarang bisa punya banyak "batch" harga
  // (beda supplier/kedatangan barang, harga modal & jual beda-beda).
  photoUrl    String?  @map("photo_url")
```

- [ ] **Step 2: Ganti model `ItemCost` total**

Cari `model ItemCost {` di `prisma/schema.prisma`, ganti SELURUH isinya jadi:
```prisma
// Siklus batch-cost (2026-09) — 1 baris = 1 "batch" (kedatangan barang),
// PUNYA harga modal & jual sendiri. `kind='product'` boleh banyak baris
// per `refId` (banyak batch sekaligus). `kind='sparepart'` TETAP dijaga di
// kode (StockService) cuma 1 baris per `refId` (upsert) — sparepart gak
// ikut sistem batch, `sellPrice`/`stock` sparepart tetap di tabel
// `spareparts` sendiri, kolom `sellPrice`/`stock` di sini buat baris
// sparepart diisi 0 (gak dipakai/gak dibaca).
model ItemCost {
  id           String   @id @default(uuid())
  kind         String // 'product' | 'sparepart'
  refId        String   @map("ref_id")
  supplierName String?  @map("supplier_name")
  buyPrice     Decimal  @map("buy_price") @db.Decimal(14, 2)
  sellPrice    Decimal  @map("sell_price") @db.Decimal(14, 2)
  stock        Int // sisa stok BATCH ini (product) — 0/gak dipakai (sparepart)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([kind, refId])
  @@map("item_costs")
}
```

- [ ] **Step 3: Tambah `discount` ke `TransactionItem` & `InvoiceItem`**

Di model `TransactionItem`, tambahkan setelah field `lineTotal`:
```prisma
  lineTotal     Decimal     @map("line_total") @db.Decimal(14, 2)
  // BARU (Siklus batch-cost 2026-09) — diskon nominal khusus baris ini,
  // numpuk (bukan gantiin) diskon level-transaksi (`Transaction.discount`).
  discount      Decimal     @default(0) @db.Decimal(14, 2)
```
Di model `InvoiceItem`, tambahkan field yang sama setelah `lineTotal` (sebelum `buyPriceSnapshot`):
```prisma
  lineTotal Decimal @map("line_total") @db.Decimal(14, 2)
  // BARU (Siklus batch-cost 2026-09) — sama kayak TransactionItem.discount.
  discount  Decimal @default(0) @db.Decimal(14, 2)
```

- [ ] **Step 4: Tambah `itemCostId` ke `StockMovement`**

Di model `StockMovement`, tambahkan setelah field `transactionId`:
```prisma
  transactionId String?  @map("transaction_id")
  // BARU (Siklus batch-cost 2026-09) — nunjuk batch (ItemCost) spesifik
  // yang kena mutasi, kalau `itemKind='product'`. Nullable: baris LAMA
  // (sebelum kolom ini ada) & baris `itemKind='sparepart'` tetap null
  // (sparepart gak ikut sistem batch). BUKAN foreign key formal — polanya
  // sama kayak `refId` di model ini (referensi polymorphic, gak strict FK).
  itemCostId    String?  @map("item_cost_id")
```

- [ ] **Step 5: Tulis migration.sql**

Buat folder `prisma/migrations/20260908000000_batch_cost_tracking/` isi file `migration.sql`:
```sql
-- Siklus batch-cost (2026-09): item_costs jadi tabel batch (banyak baris
-- per produk), sellPrice/stock pindah dari products ke situ.

-- 1) Tambah kolom baru di item_costs (nullable dulu, diisi di step
--    berikutnya, baru dikunci NOT NULL di step 7-8).
ALTER TABLE "item_costs" ADD COLUMN "id" TEXT;
ALTER TABLE "item_costs" ADD COLUMN "sell_price" DECIMAL(14,2);
ALTER TABLE "item_costs" ADD COLUMN "stock" INTEGER;
ALTER TABLE "item_costs" ADD COLUMN "supplier_name" TEXT;
ALTER TABLE "item_costs" ADD COLUMN "created_at" TIMESTAMP(3);

-- 2) Backfill id unik buat semua baris lama. Sengaja PAKAI md5(random())
--    bukan gen_random_uuid()/uuid_generate_v4() — extension itu belum
--    tentu aktif di semua environment Postgres (sama pertimbangan kayak
--    migrasi 20260822030000_job_findings_checklist). Kolom "id" bertipe
--    TEXT biasa (bukan native uuid), jadi string hex 32-karakter ini valid.
UPDATE "item_costs"
SET "id" = md5(random()::text || clock_timestamp()::text || "kind" || "ref_id")
WHERE "id" IS NULL;

-- 3) Backfill sell_price/stock buat baris kind='product' DARI products
--    (sebelum kolomnya dihapus di step 9), created_at dari updated_at lama
--    (perkiraan — data asli kapan batch itu masuk gak pernah dicatat).
UPDATE "item_costs" ic
SET "sell_price" = p."sell_price",
    "stock" = p."stock",
    "created_at" = COALESCE(ic."updated_at", CURRENT_TIMESTAMP)
FROM "products" p
WHERE ic."kind" = 'product' AND ic."ref_id" = p."id";

-- 4) Backfill created_at buat baris kind='sparepart' (sell_price/stock
--    baris ini SENGAJA dibiarkan NULL dulu, diisi 0 di step 7 — gak
--    dipakai sama sekali buat sparepart, cuma buat penuhin NOT NULL).
UPDATE "item_costs" SET "created_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
WHERE "kind" = 'sparepart';

-- 5) Produk yang PUNYA sell_price/stock tapi BELUM PERNAH ada baris
--    item_costs (belum pernah di-stock-in lewat Siklus 3) — bikin 1 baris
--    "batch awal" biar stok/harga yang lagi berjalan gak hilang. buy_price
--    diisi 0 + supplier_name ditandai jelas (bukan silently 0 tanpa keterangan).
INSERT INTO "item_costs" ("id", "kind", "ref_id", "buy_price", "sell_price", "stock", "supplier_name", "created_at", "updated_at")
SELECT
  md5(random()::text || clock_timestamp()::text || p."id"),
  'product', p."id", 0, p."sell_price", p."stock",
  '(migrasi 2026-09-08 — harga beli belum tercatat)',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "products" p
WHERE NOT EXISTS (
  SELECT 1 FROM "item_costs" ic WHERE ic."kind" = 'product' AND ic."ref_id" = p."id"
);

-- 6) Baris sparepart: sell_price/stock diisi 0 (placeholder, gak kepake).
UPDATE "item_costs" SET "sell_price" = 0, "stock" = 0 WHERE "kind" = 'sparepart';

-- 7) Kunci NOT NULL + default buat kolom baru.
ALTER TABLE "item_costs" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "item_costs" ALTER COLUMN "sell_price" SET NOT NULL;
ALTER TABLE "item_costs" ALTER COLUMN "stock" SET NOT NULL;
ALTER TABLE "item_costs" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "item_costs" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- 8) Ganti PK dari (kind, ref_id) jadi id.
ALTER TABLE "item_costs" DROP CONSTRAINT "item_costs_pkey";
ALTER TABLE "item_costs" ADD CONSTRAINT "item_costs_pkey" PRIMARY KEY ("id");
CREATE INDEX "item_costs_kind_ref_id_idx" ON "item_costs"("kind", "ref_id");

-- 9) Data udah pindah semua ke item_costs — sekarang aman hapus dari products.
ALTER TABLE "products" DROP COLUMN "sell_price";
ALTER TABLE "products" DROP COLUMN "stock";

-- 10) Diskon per-baris.
ALTER TABLE "transaction_items" ADD COLUMN "discount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice_items" ADD COLUMN "discount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- 11) Jejak batch di histori stok (nullable, baris lama tetap null).
ALTER TABLE "stock_movements" ADD COLUMN "item_cost_id" TEXT;
```

- [ ] **Step 6: Validasi schema & generate client**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: selesai tanpa error, `@prisma/client` ke-update dengan tipe `ItemCost` baru (field `id`, `sellPrice`, `stock`, `supplierName`).

- [ ] **Step 7: Jalankan migrasi ke database beneran & verifikasi data**

Run: `npx prisma migrate deploy`
Expected: migrasi `20260908000000_batch_cost_tracking` berhasil, gak ada error.

Verifikasi manual (run lewat `npx prisma studio` atau `psql`):
```sql
-- Jumlah produk vs jumlah produk yang punya minimal 1 batch item_costts —
-- harus SAMA (gak ada produk yang "kehilangan" datanya).
SELECT
  (SELECT COUNT(*) FROM products) AS total_produk,
  (SELECT COUNT(DISTINCT ref_id) FROM item_costs WHERE kind = 'product') AS produk_punya_batch;
```
Expected: dua angka itu SAMA.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260908000000_batch_cost_tracking
git commit -m "feat(db): restrukturisasi item_costs jadi tabel batch harga modal/jual"
```

---

### Task 2: Util & Exception Bersama (`checkBelowCost`, `ConfirmationRequiredException`)

**Files:**
- Create: `src/common/below-cost.util.ts`
- Test: `src/common/below-cost.util.spec.ts`
- Create: `src/common/exceptions/confirmation-required.exception.ts`

- [ ] **Step 1: Tulis test buat `checkBelowCost`**

`src/common/below-cost.util.spec.ts`:
```ts
import { checkBelowCost } from './below-cost.util';

describe('checkBelowCost', () => {
  it('gak kena warning kalau harga efektif di atas modal', () => {
    const result = checkBelowCost({ buyPrice: 2_900_000, sellPrice: 3_000_000 });
    expect(result.isBelowCost).toBe(false);
    expect(result.effectivePrice).toBe(3_000_000);
  });

  it('kena warning kalau harga efektif PERSIS sama modal (breakeven)', () => {
    const result = checkBelowCost({ buyPrice: 3_000_000, sellPrice: 3_000_000 });
    expect(result.isBelowCost).toBe(true);
  });

  it('kena warning kalau harga efektif di bawah modal setelah diskon', () => {
    const result = checkBelowCost({ buyPrice: 3_100_000, sellPrice: 3_200_000, discount: 150_000 });
    expect(result.isBelowCost).toBe(true);
    expect(result.effectivePrice).toBe(3_050_000);
  });

  it('diskon gak diisi dianggap 0', () => {
    const result = checkBelowCost({ buyPrice: 2_000_000, sellPrice: 2_500_000 });
    expect(result.effectivePrice).toBe(2_500_000);
    expect(result.isBelowCost).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, pastikan gagal**

Run: `npx jest src/common/below-cost.util.spec.ts`
Expected: FAIL — `Cannot find module './below-cost.util'`

- [ ] **Step 3: Implementasi `checkBelowCost`**

`src/common/below-cost.util.ts`:
```ts
/**
 * Cek harga jual efektif (setelah diskon per-item) VS harga modal batch —
 * dipakai bareng PosService (checkout) & StockService (barang masuk) biar
 * aturan "jual di bawah modal" konsisten di dua tempat itu. Breakeven
 * (effectivePrice === buyPrice) DIANGGAP kena warning juga, bukan cuma
 * yang di bawahnya — dikonfirmasi user 2026-09-08.
 */
export interface BelowCostInput {
  buyPrice: number;
  sellPrice: number;
  discount?: number;
}

export interface BelowCostResult {
  isBelowCost: boolean;
  effectivePrice: number;
}

export function checkBelowCost({
  buyPrice,
  sellPrice,
  discount = 0,
}: BelowCostInput): BelowCostResult {
  const effectivePrice = sellPrice - discount;
  return { isBelowCost: effectivePrice <= buyPrice, effectivePrice };
}
```

- [ ] **Step 4: Run test, pastikan lolos**

Run: `npx jest src/common/below-cost.util.spec.ts`
Expected: PASS, 4 test lolos.

- [ ] **Step 5: Bikin `ConfirmationRequiredException`**

`src/common/exceptions/confirmation-required.exception.ts`:
```ts
/** 1 baris peringatan "jual/beli di bawah modal" — dikirim balik ke FE
 * biar bisa ditampilin di dialog konfirmasi. */
export interface BelowCostWarning {
  refId: string;
  itemCostId: string | null; // null kalau batchnya belum kebuat (stock-in)
  name: string;
  buyPrice: number;
  sellPrice: number;
  discount: number;
  effectivePrice: number;
}

/**
 * Dilempar DI DALAM Prisma `$transaction` (PosService.checkout /
 * StockService.stockIn) begitu ketauan ada baris yang harga efektifnya di
 * bawah/pas modal DAN request belum bawa `confirmOverride: true`. Prisma
 * otomatis ROLLBACK transaksi begitu callback-nya throw apapun — jadi gak
 * ada data yang sempet ke-commit. Method pemanggil WAJIB nangkep exception
 * ini DI LUAR `$transaction` dan balikin `{ status: 'confirm_required',
 * warnings }` (HTTP 200, BUKAN error) — pola "soft-warn + confirm"
 * (bukan blokir keras) yang disepakati user 2026-09-08.
 */
export class ConfirmationRequiredException extends Error {
  constructor(public readonly warnings: BelowCostWarning[]) {
    super('Butuh konfirmasi: ada item yang dijual/dibeli di bawah harga modal');
    this.name = 'ConfirmationRequiredException';
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/common/below-cost.util.ts src/common/below-cost.util.spec.ts src/common/exceptions/confirmation-required.exception.ts
git commit -m "feat(common): tambah checkBelowCost util & ConfirmationRequiredException"
```

---

### Task 3: `StockLockingService` — Pisah Jalur Lock Produk (FIFO vs Manual-Batch)

**Files:**
- Modify: `src/common/services/stock-locking.service.ts` (replace seluruh isi)
- Test: `src/common/services/stock-locking.service.spec.ts`

- [ ] **Step 1: Tulis test buat `lockAndDeductProductBatch`**

`src/common/services/stock-locking.service.spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { StockLockingService } from './stock-locking.service';

function fakeTx(queryResult: unknown[]) {
  return {
    $queryRawUnsafe: jest.fn().mockResolvedValue(queryResult),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  } as any;
}

describe('StockLockingService.lockAndDeductProductBatch', () => {
  it('kurangi stok batch & balikin harga modal+jual batch itu', async () => {
    const service = new StockLockingService();
    const tx = fakeTx([
      { product_name: 'AC Split 1PK', active: true, stock: 5, sell_price: '3200000', buy_price: '3100000' },
    ]);

    const result = await service.lockAndDeductProductBatch(tx, 'batch-1', 2);

    expect(result).toEqual({ name: 'AC Split 1PK', unit: 'unit', unitPrice: 3200000, buyPrice: 3100000 });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE item_costs SET stock = stock - $1'),
      2,
      'batch-1',
    );
  });

  it('lempar BadRequestException kalau batch gak ketemu', async () => {
    const service = new StockLockingService();
    const tx = fakeTx([]);
    await expect(service.lockAndDeductProductBatch(tx, 'batch-x', 1)).rejects.toThrow(BadRequestException);
  });

  it('lempar BadRequestException kalau stok batch gak cukup', async () => {
    const service = new StockLockingService();
    const tx = fakeTx([
      { product_name: 'AC Split 1PK', active: true, stock: 1, sell_price: '3200000', buy_price: '3100000' },
    ]);
    await expect(service.lockAndDeductProductBatch(tx, 'batch-1', 5)).rejects.toThrow(BadRequestException);
  });

  it('lempar BadRequestException kalau produk induk nonaktif', async () => {
    const service = new StockLockingService();
    const tx = fakeTx([
      { product_name: 'AC Split 1PK', active: false, stock: 5, sell_price: '3200000', buy_price: '3100000' },
    ]);
    await expect(service.lockAndDeductProductBatch(tx, 'batch-1', 1)).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test, pastikan gagal**

Run: `npx jest src/common/services/stock-locking.service.spec.ts`
Expected: FAIL — `service.lockAndDeductProductBatch is not a function`

- [ ] **Step 3: Ganti seluruh isi `stock-locking.service.ts`**

`src/common/services/stock-locking.service.ts` (replace seluruh file):
```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type StockKind = 'product' | 'sparepart';

export interface LockedItem {
  name: string;
  unit: string;
  unitPrice: number;
  buyPrice: number | null;
}

/**
 * Port dari pola `FOR UPDATE` di checkout_transaction (pos_functions.sql,
 * baris ~308-336) dan mark_material_used (payment_approval_photo_rules.sql).
 * `FOR UPDATE` mengunci baris sampai transaksi commit/rollback. WAJIB
 * dipanggil di dalam Prisma interactive transaction (`$transaction`).
 *
 * Siklus batch-cost (2026-09) — `product` sekarang punya banyak "batch"
 * harga (tabel `item_costs`), `sparepart` TETAP 1 harga simpel langsung di
 * tabel `spareparts`. Dua kind ini sekarang punya jalur lock yang beda
 * total buat produk, bukan cuma parameter tabel yang beda kayak dulu.
 */
@Injectable()
export class StockLockingService {
  /**
   * Kunci & kurangi stok. `sparepart` — persis kayak sebelumnya, langsung
   * di tabel `spareparts`. `product` — otomatis FIFO lintas batch
   * `item_costs` (batch TERTUA duluan). Dipakai caller yang TIDAK minta
   * user milih batch spesifik (MaterialRequestsService — pengajuan
   * material teknisi). PosService.checkout TIDAK lewat sini buat
   * kind='product' — dia pakai `lockAndDeductProductBatch` di bawah,
   * karena kasir manual milih batch mana yang dijual.
   */
  async lockAndDeduct(
    tx: Prisma.TransactionClient,
    kind: StockKind,
    refId: string,
    qty: number,
  ): Promise<LockedItem> {
    if (kind === 'sparepart') {
      const rows = await tx.$queryRawUnsafe<
        { name: string; active: boolean; stock: unknown; sell_price: unknown }[]
      >(`SELECT name, active, stock, sell_price FROM spareparts WHERE id = $1 FOR UPDATE`, refId);

      const row = rows[0];
      if (!row) throw new BadRequestException(`Item sparepart ${refId} tidak ditemukan`);
      if (!row.active) throw new BadRequestException(`${row.name} tidak aktif`);
      if (Number(row.stock) < qty) {
        throw new BadRequestException(`Stok ${row.name} tidak cukup`);
      }

      await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = stock - $1 WHERE id = $2`, qty, refId);

      return { name: row.name, unit: 'pcs', unitPrice: Number(row.sell_price), buyPrice: null };
    }

    // kind === 'product' — FIFO lintas batch item_costs.
    const productRows = await tx.$queryRawUnsafe<{ name: string; active: boolean }[]>(
      `SELECT name, active FROM products WHERE id = $1`,
      refId,
    );
    const product = productRows[0];
    if (!product) throw new BadRequestException(`Produk ${refId} tidak ditemukan`);
    if (!product.active) throw new BadRequestException(`${product.name} tidak aktif`);

    const batches = await tx.$queryRawUnsafe<
      { id: string; stock: number; sell_price: unknown; buy_price: unknown }[]
    >(
      `SELECT id, stock, sell_price, buy_price FROM item_costs
       WHERE kind = 'product' AND ref_id = $1 AND stock > 0
       ORDER BY created_at ASC FOR UPDATE`,
      refId,
    );

    let remaining = qty;
    let firstPrice: number | null = null;
    let firstBuyPrice: number | null = null;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, batch.stock);
      if (take <= 0) continue;
      await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = stock - $1 WHERE id = $2`, take, batch.id);
      if (firstPrice === null) {
        firstPrice = Number(batch.sell_price);
        firstBuyPrice = Number(batch.buy_price);
      }
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BadRequestException(`Stok ${product.name} tidak cukup`);
    }

    return { name: product.name, unit: 'unit', unitPrice: firstPrice ?? 0, buyPrice: firstBuyPrice };
  }

  /**
   * Khusus checkout (PosService) — kasir udah manual milih BATCH spesifik
   * lewat dialog pemilihan batch di POS. Kunci 1 baris `item_costs` persis
   * sesuai `itemCostId` (`FOR UPDATE OF ic` — sengaja gak ikut ngunci baris
   * `products` yang di-JOIN, biar 2 checkout produk yang sama tapi beda
   * batch tetap bisa jalan paralel), validasi produk induk masih aktif,
   * cek stok batch cukup, lalu kurangi.
   */
  async lockAndDeductProductBatch(
    tx: Prisma.TransactionClient,
    itemCostId: string,
    qty: number,
  ): Promise<LockedItem> {
    const rows = await tx.$queryRawUnsafe<
      { product_name: string; active: boolean; stock: number; sell_price: unknown; buy_price: unknown }[]
    >(
      `SELECT p.name AS product_name, p.active AS active, ic.stock AS stock,
              ic.sell_price AS sell_price, ic.buy_price AS buy_price
       FROM item_costs ic
       JOIN products p ON p.id = ic.ref_id
       WHERE ic.id = $1 AND ic.kind = 'product'
       FOR UPDATE OF ic`,
      itemCostId,
    );

    const row = rows[0];
    if (!row) throw new BadRequestException(`Batch produk ${itemCostId} tidak ditemukan`);
    if (!row.active) throw new BadRequestException(`${row.product_name} tidak aktif`);
    if (row.stock < qty) {
      throw new BadRequestException(`Stok batch ${row.product_name} tidak cukup`);
    }

    await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = stock - $1 WHERE id = $2`, qty, itemCostId);

    return {
      name: row.product_name,
      unit: 'unit',
      unitPrice: Number(row.sell_price),
      buyPrice: Number(row.buy_price),
    };
  }

  /**
   * Kunci 1 baris `spareparts`, tambah stok. Dipakai barang masuk & opname
   * SPAREPART SAJA. TIDAK cek `active`. Siklus batch-cost (2026-09):
   * kind='product' TIDAK lewat sini lagi — barang masuk produk sekarang
   * selalu bikin baris `item_costs` (batch) baru lewat
   * `StockService.stockIn()` langsung (`tx.itemCost.create`), gak lewat
   * increment kayak dulu.
   */
  async lockAndAdd(
    tx: Prisma.TransactionClient,
    refId: string,
    qty: number,
  ): Promise<{ name: string; previousStock: number }> {
    const rows = await tx.$queryRawUnsafe<{ name: string; stock: unknown }[]>(
      `SELECT name, stock FROM spareparts WHERE id = $1 FOR UPDATE`,
      refId,
    );

    const row = rows[0];
    if (!row) throw new BadRequestException(`Item sparepart ${refId} tidak ditemukan`);

    await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = stock + $1 WHERE id = $2`, qty, refId);

    return { name: row.name, previousStock: Number(row.stock) };
  }
}
```

- [ ] **Step 4: Run test, pastikan lolos**

Run: `npx jest src/common/services/stock-locking.service.spec.ts`
Expected: PASS, 4 test lolos.

- [ ] **Step 5: Commit**

```bash
git add src/common/services/stock-locking.service.ts src/common/services/stock-locking.service.spec.ts
git commit -m "refactor(stock-locking): pisah jalur lock produk jadi FIFO otomatis vs pilih-batch-manual"
```

---

### Task 4: DTO — `StockInDto` & `OpnameItemDto`

**Files:**
- Modify: `src/stock/dto/stock-in.dto.ts` (replace seluruh isi)
- Modify: `src/stock/dto/stock-opname.dto.ts` (replace seluruh isi)

- [ ] **Step 1: Ganti `stock-in.dto.ts`**

`src/stock/dto/stock-in.dto.ts` (replace seluruh file):
```ts
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsQtyValidForKind } from './qty-by-kind.validator';

export class StockInDto {
  @IsIn(['product', 'sparepart'])
  kind: 'product' | 'sparepart';

  @IsString()
  @IsNotEmpty()
  refId: string;

  @IsNumber()
  @Min(0.01)
  @IsQtyValidForKind('kind')
  qty: number;

  @IsNumber()
  @Min(0)
  buyPrice: number;

  // Wajib diisi kalau kind='product' — harga jual BATCH baru ini. Dibanding-
  // kan ke buyPrice: kalau <= buyPrice, backend balikin peringatan dulu
  // (lihat StockService.stockIn), gak langsung disimpan.
  @ValidateIf((o: StockInDto) => o.kind === 'product')
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  // Opsional, catatan asal barang — cuma dipakai kalau kind='product'.
  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // Dikirim ulang (true) setelah admin confirm peringatan "harga jual di
  // bawah/pas modal" pas input barang masuk produk baru.
  @IsOptional()
  @IsBoolean()
  confirmOverride?: boolean;
}
```

- [ ] **Step 2: Ganti `stock-opname.dto.ts`**

`src/stock/dto/stock-opname.dto.ts` (replace seluruh file):
```ts
import {
  ArrayMinSize,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsQtyValidForKind } from './qty-by-kind.validator';

export class OpnameItemDto {
  @IsIn(['product', 'sparepart'])
  kind: 'product' | 'sparepart';

  @IsString()
  @IsNotEmpty()
  refId: string;

  // Wajib diisi kalau kind='product' — batch (item_costs) mana yang
  // dikoreksi. Siklus batch-cost (2026-09): opname produk sekarang PER-
  // BATCH, bukan per-produk lagi (produk bisa punya banyak batch aktif
  // sekaligus, gak ada lagi 1 angka stok tunggal).
  @ValidateIf((o: OpnameItemDto) => o.kind === 'product')
  @IsString()
  @IsNotEmpty()
  itemCostId?: string;

  @IsNumber()
  @Min(0)
  @IsQtyValidForKind('kind')
  physicalQty: number;
}

export class StockOpnameDto {
  @ValidateNested({ each: true })
  @Type(() => OpnameItemDto)
  @ArrayMinSize(1)
  items: OpnameItemDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
```

- [ ] **Step 3: Build TypeScript, pastikan gak ada error type dari DTO ini sendiri**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "stock-in.dto|stock-opname.dto"`
Expected: kosong (gak ada error DARI FILE INI — error di file LAIN yang belum disentuh Task 5/6 masih wajar di titik ini, itu dibereskan task-task berikutnya).

- [ ] **Step 4: Commit**

```bash
git add src/stock/dto/stock-in.dto.ts src/stock/dto/stock-opname.dto.ts
git commit -m "feat(stock): DTO stock-in & opname dukung batch produk (sellPrice, itemCostId, confirmOverride)"
```

---

### Task 5: `StockService.stockIn()` — Bikin Batch Baru + Warning

**Files:**
- Modify: `src/stock/stock.service.ts` (method `stockIn`)

- [ ] **Step 1: Ganti method `stockIn`**

Di `src/stock/stock.service.ts`, ganti import di baris paling atas:
```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService } from '../common/services/stock-locking.service';
import { StockInDto } from './dto/stock-in.dto';
import { StockOpnameDto } from './dto/stock-opname.dto';
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';
import { checkBelowCost } from '../common/below-cost.util';
import { ConfirmationRequiredException } from '../common/exceptions/confirmation-required.exception';
```

Ganti seluruh method `stockIn` (dari `async stockIn(dto: StockInDto, actorId: string) {` sampai `}` penutupnya) jadi:
```ts
  /** Barang masuk: sparepart tetap 1 harga (upsert), produk selalu bikin
   * batch (ItemCost) baru + cek warning "jual di bawah modal". */
  async stockIn(dto: StockInDto, actorId: string) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (dto.kind === 'sparepart') {
          const { name, previousStock } = await this.stockLocking.lockAndAdd(tx, dto.refId, dto.qty);

          const movement = await tx.stockMovement.create({
            data: {
              itemKind: dto.kind,
              refId: dto.refId,
              name,
              qtyChange: dto.qty,
              reason: 'barang_masuk',
              createdById: actorId,
            },
          });

          // CATATAN (koreksi 2026-09-08, ditemukan implementer Task 5/6):
          // BUKAN tx.itemCost.upsert({where:{kind_refId:...}}}) — PK
          // item_costs sekarang `id` sendiri, `[kind,refId]` cuma @@index
          // BIASA (bukan @@unique — sengaja, kind='product' harus boleh
          // banyak baris per refId buat batch). Prisma gak generate tipe
          // filter compound `kind_refId` dari index biasa, jadi upsert
          // manual pakai findFirst + conditional update/create:
          const existingSparepartCost = await tx.itemCost.findFirst({
            where: { kind: 'sparepart', refId: dto.refId },
          });
          if (existingSparepartCost) {
            await tx.itemCost.update({
              where: { id: existingSparepartCost.id },
              data: { buyPrice: dto.buyPrice },
            });
          } else {
            await tx.itemCost.create({
              data: { kind: 'sparepart', refId: dto.refId, buyPrice: dto.buyPrice, sellPrice: 0, stock: 0 },
            });
          }

          await tx.auditLog.create({
            data: {
              actorUid: actorId,
              action: 'stock.in',
              target: dto.refId,
              detail: {
                kind: dto.kind,
                name,
                qty: dto.qty,
                buyPrice: dto.buyPrice,
                previousStock,
                note: dto.note ?? null,
              },
            },
          });

          return {
            kind: 'sparepart' as const,
            movementId: movement.id,
            refId: dto.refId,
            name,
            previousStock,
            newStock: previousStock + dto.qty,
          };
        }

        // kind === 'product' — selalu bikin batch (item_costs) BARU.
        const sellPrice = dto.sellPrice!; // dijamin ada oleh @ValidateIf di DTO
        const product = await tx.product.findUnique({ where: { id: dto.refId } });
        if (!product) throw new BadRequestException(`Produk ${dto.refId} tidak ditemukan`);

        const { isBelowCost, effectivePrice } = checkBelowCost({ buyPrice: dto.buyPrice, sellPrice });
        if (isBelowCost && !dto.confirmOverride) {
          throw new ConfirmationRequiredException([
            {
              refId: dto.refId,
              itemCostId: null,
              name: product.name,
              buyPrice: dto.buyPrice,
              sellPrice,
              discount: 0,
              effectivePrice,
            },
          ]);
        }

        const batch = await tx.itemCost.create({
          data: {
            kind: 'product',
            refId: dto.refId,
            supplierName: dto.supplierName,
            buyPrice: dto.buyPrice,
            sellPrice,
            stock: dto.qty,
          },
        });

        await tx.stockMovement.create({
          data: {
            itemKind: 'product',
            refId: dto.refId,
            name: product.name,
            qtyChange: dto.qty,
            reason: 'barang_masuk',
            createdById: actorId,
            itemCostId: batch.id,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'stock.in',
            target: dto.refId,
            detail: {
              kind: 'product',
              name: product.name,
              qty: dto.qty,
              buyPrice: dto.buyPrice,
              sellPrice,
              supplierName: dto.supplierName ?? null,
              batchId: batch.id,
              note: dto.note ?? null,
              override: isBelowCost || undefined,
            },
          },
        });

        return {
          kind: 'product' as const,
          batchId: batch.id,
          refId: dto.refId,
          name: product.name,
          qty: dto.qty,
          buyPrice: dto.buyPrice,
          sellPrice,
        };
      });
      return { status: 'ok' as const, ...result };
    } catch (err) {
      if (err instanceof ConfirmationRequiredException) {
        return { status: 'confirm_required' as const, warnings: err.warnings };
      }
      throw err;
    }
  }
```

- [ ] **Step 2: Verifikasi manual lewat HTTP (butuh server jalan + token admin)**

Run: `npm run start:dev` (biarin jalan di terminal lain), lalu:
```bash
curl -X POST http://localhost:3000/stock/in \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"product","refId":"'"$PRODUCT_ID"'","qty":5,"buyPrice":3100000,"sellPrice":2900000,"supplierName":"Toko A"}'
```
Expected: HTTP 200, body `{"status":"confirm_required","warnings":[{...,"buyPrice":3100000,"sellPrice":2900000,"effectivePrice":2900000}]}` — TIDAK ada baris `item_costs` baru kesimpen (cek `SELECT * FROM item_costs WHERE ref_id='$PRODUCT_ID' ORDER BY created_at DESC LIMIT 1` — masih batch lama).

Kirim ulang dengan `confirmOverride: true`:
```bash
curl -X POST http://localhost:3000/stock/in \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"product","refId":"'"$PRODUCT_ID"'","qty":5,"buyPrice":3100000,"sellPrice":2900000,"supplierName":"Toko A","confirmOverride":true}'
```
Expected: HTTP 200, `{"status":"ok","batchId":"...","refId":"...","qty":5,"buyPrice":3100000,"sellPrice":2900000}`. Cek `item_costs` — ada baris baru dengan `stock=5`.

- [ ] **Step 3: Commit**

```bash
git add src/stock/stock.service.ts
git commit -m "feat(stock): stockIn produk bikin batch baru + warning harga di bawah modal"
```

---

### Task 6: `StockService.opname()` — Koreksi Per-Batch

**Files:**
- Modify: `src/stock/stock.service.ts` (method `opname`)

- [ ] **Step 1: Ganti method `opname`**

Ganti seluruh method `opname` (dari `async opname(dto: StockOpnameDto, actorId: string) {` sampai `}` penutupnya) jadi:
```ts
  /** Stock opname: koreksi stok LANGSUNG ke angka fisik. Sparepart per-
   * produk (kayak dulu), produk PER-BATCH (item_costs) — produk bisa
   * punya banyak batch aktif sekaligus, jadi opname harus nunjuk batch
   * mana yang dikoreksi (`itemCostId`). */
  async opname(dto: StockOpnameDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // sort dulu (sparepart by refId, produk by itemCostId) — hindari
      // deadlock kalau ada opname/checkout lain jalan barengan.
      const sorted = [...dto.items].sort((a, b) => {
        const keyA = a.kind === 'product' ? a.itemCostId! : a.refId;
        const keyB = b.kind === 'product' ? b.itemCostId! : b.refId;
        return keyA.localeCompare(keyB);
      });

      const results: Array<{
        refId: string;
        itemCostId: string | null;
        name: string;
        systemQty: number;
        physicalQty: number;
        delta: number;
      }> = [];

      for (const item of sorted) {
        if (item.kind === 'sparepart') {
          const rows = await tx.$queryRawUnsafe<{ name: string; stock: unknown }[]>(
            `SELECT name, stock FROM spareparts WHERE id = $1 FOR UPDATE`,
            item.refId,
          );
          const row = rows[0];
          if (!row) throw new BadRequestException(`Item ${item.refId} tidak ditemukan`);

          const systemQty = Number(row.stock);
          const delta = item.physicalQty - systemQty;

          if (delta === 0) {
            results.push({ refId: item.refId, itemCostId: null, name: row.name, systemQty, physicalQty: item.physicalQty, delta: 0 });
            continue;
          }

          await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = $1 WHERE id = $2`, item.physicalQty, item.refId);

          await tx.stockMovement.create({
            data: {
              itemKind: 'sparepart',
              refId: item.refId,
              name: row.name,
              qtyChange: delta,
              reason: 'opname',
              createdById: actorId,
            },
          });

          await tx.auditLog.create({
            data: {
              actorUid: actorId,
              action: 'stock.opname',
              target: item.refId,
              detail: { kind: 'sparepart', name: row.name, systemQty, physicalQty: item.physicalQty, delta, note: dto.note ?? null },
            },
          });

          results.push({ refId: item.refId, itemCostId: null, name: row.name, systemQty, physicalQty: item.physicalQty, delta });
          continue;
        }

        // kind === 'product' — koreksi 1 BATCH spesifik.
        const rows = await tx.$queryRawUnsafe<{ name: string; stock: number }[]>(
          `SELECT p.name AS name, ic.stock AS stock
           FROM item_costs ic
           JOIN products p ON p.id = ic.ref_id
           WHERE ic.id = $1 AND ic.kind = 'product'
           FOR UPDATE OF ic`,
          item.itemCostId,
        );
        const row = rows[0];
        if (!row) throw new BadRequestException(`Batch ${item.itemCostId} tidak ditemukan`);

        const systemQty = row.stock;
        const delta = item.physicalQty - systemQty;

        if (delta === 0) {
          results.push({ refId: item.refId, itemCostId: item.itemCostId!, name: row.name, systemQty, physicalQty: item.physicalQty, delta: 0 });
          continue;
        }

        await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = $1 WHERE id = $2`, item.physicalQty, item.itemCostId);

        await tx.stockMovement.create({
          data: {
            itemKind: 'product',
            refId: item.refId,
            name: row.name,
            qtyChange: delta,
            reason: 'opname',
            createdById: actorId,
            itemCostId: item.itemCostId,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'stock.opname',
            target: item.refId,
            detail: { kind: 'product', itemCostId: item.itemCostId, name: row.name, systemQty, physicalQty: item.physicalQty, delta, note: dto.note ?? null },
          },
        });

        results.push({ refId: item.refId, itemCostId: item.itemCostId!, name: row.name, systemQty, physicalQty: item.physicalQty, delta });
      }

      return results;
    });
  }
```

- [ ] **Step 2: Verifikasi manual**

```bash
curl -X POST http://localhost:3000/stock/opname \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"items":[{"kind":"product","refId":"'"$PRODUCT_ID"'","itemCostId":"'"$BATCH_ID"'","physicalQty":3}]}'
```
Expected: HTTP 200, array berisi `{refId, itemCostId, name, systemQty, physicalQty:3, delta}`. Cek `item_costs.stock` buat batch itu berubah jadi 3.

- [ ] **Step 3: Commit**

```bash
git add src/stock/stock.service.ts
git commit -m "feat(stock): opname produk sekarang per-batch (itemCostId), bukan per-produk"
```

---

### Task 7: `CheckoutDto` & `CheckoutItemDto`

**Files:**
- Modify: `src/pos/dto/checkout.dto.ts` (replace seluruh isi)

- [ ] **Step 1: Ganti seluruh isi file**

`src/pos/dto/checkout.dto.ts` (replace seluruh file):
```ts
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CheckoutCustomerDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() phone: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() memberId?: string;
}

export class CheckoutItemDto {
  @IsIn(['product', 'sparepart', 'service']) kind: 'product' | 'sparepart' | 'service';
  @IsString() @IsNotEmpty() refId: string;

  // Wajib diisi kalau kind='product' — id batch (ItemCost) yang dipilih
  // kasir di dialog pemilihan batch. Nentuin harga jual & modal mana yang
  // dipakai buat baris ini (1 produk bisa punya banyak batch harga beda).
  @ValidateIf((o: CheckoutItemDto) => o.kind === 'product')
  @IsString()
  @IsNotEmpty()
  itemCostId?: string;

  @IsNumber() @Min(0.01) qty: number;

  // BARU — diskon nominal khusus baris ini, numpuk (bukan gantiin) diskon
  // level-transaksi di bawah. Dibandingkan ke buyPrice batch (lewat
  // checkBelowCost) buat warning "jual di bawah modal", cuma berlaku buat
  // kind='product'.
  @IsOptional() @IsNumber() @Min(0) discount?: number;
}

export class CheckoutInstallationDto {
  @IsInt() @Min(0) itemIndex: number;
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsString() technicianId?: string;
  @IsOptional() @IsString() packageId?: string;
}

export class CheckoutDto {
  @ValidateNested() @Type(() => CheckoutCustomerDto) customer: CheckoutCustomerDto;

  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  @ArrayMinSize(1)
  items: CheckoutItemDto[];

  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsString() discountReason?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxPercent?: number;
  @IsOptional() @IsNumber() @Min(0) transportFee?: number;
  @IsOptional() @IsString() notes?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CheckoutInstallationDto)
  installations?: CheckoutInstallationDto[];

  @IsOptional() @IsString() voucherClaimId?: string;

  // BARU — dikirim ulang (true) setelah kasir/admin confirm dialog warning
  // "harga di bawah modal". Kalau ada baris yang kena warning dan flag ini
  // BUKAN true, checkout batal commit & balikin daftar warning-nya.
  @IsOptional() @IsBoolean() confirmOverride?: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pos/dto/checkout.dto.ts
git commit -m "feat(pos): CheckoutDto dukung itemCostId, discount per-item, confirmOverride"
```

---

### Task 8: `pos-calc.util.ts` — Diskon Per-Baris di `computeTotals`

**Files:**
- Modify: `src/pos/pos-calc.util.ts`
- Test: `src/pos/pos-calc.util.spec.ts`

- [ ] **Step 1: Tulis test buat perilaku baru**

`src/pos/pos-calc.util.spec.ts`:
```ts
import { computeTotals } from './pos-calc.util';

describe('computeTotals', () => {
  it('subtotal termasuk diskon per-baris (BARU)', () => {
    const totals = computeTotals(
      [{ qty: 1, unitPrice: 3_200_000, discount: 250_000 }],
      0,
      0,
      0,
    );
    expect(totals.subtotal).toBe(2_950_000);
    expect(totals.grandTotal).toBe(2_950_000);
  });

  it('baris tanpa discount dianggap 0 (gak breaking existing behavior)', () => {
    const totals = computeTotals([{ qty: 2, unitPrice: 100_000 }], 0, 0, 0);
    expect(totals.subtotal).toBe(200_000);
  });

  it('diskon level-transaksi tetep numpuk DI ATAS diskon per-baris', () => {
    const totals = computeTotals(
      [{ qty: 1, unitPrice: 1_000_000, discount: 100_000 }],
      50_000, // diskon cart-level
      10,
      0,
    );
    // subtotal = 900_000 (udah net diskon per-baris)
    // taxBase = 900_000 - 50_000 = 850_000
    // taxAmount = 85_000
    expect(totals.subtotal).toBe(900_000);
    expect(totals.taxAmount).toBe(85_000);
    expect(totals.grandTotal).toBe(935_000);
  });
});
```

- [ ] **Step 2: Run test, pastikan gagal**

Run: `npx jest src/pos/pos-calc.util.spec.ts`
Expected: FAIL pada test pertama — `subtotal` masih `3_200_000` (belum ngurangin discount, TypeScript juga bakal komplain field `discount` gak dikenal di tipe `lines`).

- [ ] **Step 3: Update `computeTotals`**

`src/pos/pos-calc.util.ts` (replace seluruh file):
```ts
/** Port dari totals.ts lama — logicnya sudah kebukti benar, cuma pindah bahasa. */
export function computeTotals(
  lines: { qty: number; unitPrice: number; discount?: number }[],
  discount: number,
  taxPercent: number,
  transportFee: number,
) {
  const subtotal = lines.reduce(
    (sum, l) => sum + Math.round(l.qty * l.unitPrice) - (l.discount ?? 0),
    0,
  );
  const taxBase = subtotal - discount;
  const taxAmount = Math.round((taxBase * taxPercent) / 100);
  const grandTotal = taxBase + taxAmount + transportFee;
  return { subtotal, taxAmount, grandTotal };
}

export function formatInvoiceNumber(dateKey: string, seq: number): string {
  return `INV-${dateKey}-${String(seq).padStart(4, '0')}`;
}
```

- [ ] **Step 4: Run test, pastikan lolos**

Run: `npx jest src/pos/pos-calc.util.spec.ts`
Expected: PASS, 3 test lolos.

- [ ] **Step 5: Commit**

```bash
git add src/pos/pos-calc.util.ts src/pos/pos-calc.util.spec.ts
git commit -m "feat(pos): computeTotals dukung diskon per-baris"
```

---

### Task 9: `PosService.checkout()` — Pilih-Batch, Diskon Per-Item, Warning

**Files:**
- Modify: `src/pos/pos.service.ts` (replace seluruh isi)

Ini perubahan paling besar — checkout sekarang butuh KEY per-baris yang unik (dulu `${kind}:${refId}` cukup, sekarang 2 baris produk beda batch bisa punya `refId` SAMA, jadi key harus ikut `itemCostId`), dan butuh nangkep `ConfirmationRequiredException` di luar `$transaction`.

- [ ] **Step 1: Replace seluruh `src/pos/pos.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService } from '../common/services/stock-locking.service';
import { CountersService } from '../counters/counters.service';
import { MembersService } from '../members/members.service';
import { AcUnitsService } from '../ac-units/ac-units.service';
import { TechnicianJobsService } from '../technician-jobs/technician-jobs.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { CheckoutDto, CheckoutItemDto } from './dto/checkout.dto';
import { computeTotals, formatInvoiceNumber } from './pos-calc.util';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import { checkBelowCost } from '../common/below-cost.util';
import { ConfirmationRequiredException, BelowCostWarning } from '../common/exceptions/confirmation-required.exception';

type PackageWithItems = Prisma.InstallationPackageGetPayload<{
  include: { items: true };
}>;

interface PackageChargeLine {
  instIndex: number;
  sparepartId: string | null;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  buyPriceSnapshot: number | null;
}

/** Key unik per BARIS cart. Sebelum Siklus batch-cost, `${kind}:${refId}`
 * cukup (1 baris = 1 produk). Sekarang 2 baris produk BISA punya refId
 * sama tapi beda batch (itemCostId) — jadi produk kunci pakai itemCostId,
 * bukan refId, biar 2 baris begitu gak numpuk/ketimpa di Map manapun. */
function lineKey(item: { kind: string; refId: string; itemCostId?: string }): string {
  return item.kind === 'product' ? `product:${item.itemCostId}` : `${item.kind}:${item.refId}`;
}

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockLocking: StockLockingService,
    private readonly counters: CountersService,
    private readonly members: MembersService,
    private readonly acUnits: AcUnitsService,
    private readonly technicianJobs: TechnicianJobsService,
    private readonly vouchers: VouchersService,
  ) {}

  /**
   * Port 1:1 dari checkout_transaction RPC (pos_functions.sql) + tambahan
   * lock-urut-refId (cegah deadlock antar checkout paralel) — lihat versi
   * lama buat histori lengkap.
   *
   * Siklus batch-cost (2026-09): kasir sekarang manual milih BATCH
   * (`itemCostId`) buat tiap baris `kind='product'` (bukan cuma refId
   * produk), boleh kasih diskon per-baris, dan checkout bisa balik
   * `{status:'confirm_required', warnings}` (HTTP 200, bukan error) kalau
   * ada baris yang harga efektifnya di bawah/pas modal batch itu DAN
   * request belum bawa `confirmOverride:true` — lihat
   * `ConfirmationRequiredException`.
   */
  async checkout(dto: CheckoutDto, actorId: string) {
    if ((dto.discount ?? 0) > 0 && !dto.discountReason?.trim()) {
      throw new BadRequestException('Alasan diskon wajib diisi kalau ada diskon');
    }

    const seen = new Set<string>();
    for (const item of dto.items) {
      const key = lineKey(item);
      if (seen.has(key)) throw new BadRequestException('Item duplikat');
      seen.add(key);
      if (item.kind === 'product' && item.qty !== Math.trunc(item.qty)) {
        throw new BadRequestException('Qty produk harus bilangan bulat');
      }
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const member = dto.customer.memberId
          ? await tx.member.findUnique({ where: { id: dto.customer.memberId } })
          : (await this.members.findOrCreate(tx, dto.customer.name, dto.customer.phone, dto.customer.address)).member;
        if (!member) throw new NotFoundException('Member yang dipilih tidak ditemukan');

        const packageIds = [
          ...new Set((dto.installations ?? []).map((i) => i.packageId).filter((id): id is string => !!id)),
        ];
        const packages = new Map<string, PackageWithItems>();
        for (const pkgId of packageIds) {
          const pkg = await tx.installationPackage.findUnique({ where: { id: pkgId }, include: { items: true } });
          if (!pkg || !pkg.active) throw new BadRequestException(`Paket instalasi ${pkgId} tidak ditemukan/nonaktif`);
          packages.set(pkgId, pkg);
        }

        const packageLines: PackageChargeLine[] = [];
        (dto.installations ?? []).forEach((inst, idx) => {
          if (!inst.packageId) return;
          const pkg = packages.get(inst.packageId)!;
          for (const item of pkg.items) {
            packageLines.push({
              instIndex: idx,
              sparepartId: item.sparepartId,
              name: item.name,
              unit: item.unit,
              qty: Number(item.qty),
              unitPrice: Number(item.extraPricePerUnit),
              buyPriceSnapshot: null,
            });
          }
        });
        for (const line of packageLines) {
          if (!line.sparepartId) continue;
          // Koreksi 2026-09-08 (sama alasan seperti Task 5) — findFirst,
          // bukan findUnique/kind_refId (bukan @@unique).
          const cost = await tx.itemCost.findFirst({
            where: { kind: 'sparepart', refId: line.sparepartId },
          });
          line.buyPriceSnapshot = cost ? Number(cost.buyPrice) : null;
        }

        // Gabung SEMUA kebutuhan lock stok jadi satu peta, di-lock urut key
        // (cegah deadlock). Produk dikunci per BATCH (itemCostId), sparepart
        // per refId (cart + packageLines digabung, kayak sebelumnya).
        const demand = new Map<
          string,
          { kind: 'product' | 'sparepart'; refId: string; itemCostId?: string; qty: number }
        >();
        for (const item of dto.items) {
          if (item.kind === 'service') continue;
          demand.set(lineKey(item), {
            kind: item.kind,
            refId: item.refId,
            itemCostId: item.itemCostId,
            qty: item.qty,
          });
        }
        for (const line of packageLines) {
          if (!line.sparepartId) continue;
          const key = `sparepart:${line.sparepartId}`;
          const d = demand.get(key);
          if (d) d.qty += line.qty;
          else demand.set(key, { kind: 'sparepart', refId: line.sparepartId, qty: line.qty });
        }

        const stockResults = new Map<string, { name: string; unit: string; unitPrice: number; buyPrice: number | null }>();
        for (const key of [...demand.keys()].sort()) {
          const d = demand.get(key)!;
          const result =
            d.kind === 'product'
              ? await this.stockLocking.lockAndDeductProductBatch(tx, d.itemCostId!, d.qty)
              : await this.stockLocking.lockAndDeduct(tx, 'sparepart', d.refId, d.qty);
          stockResults.set(key, result);
        }

        const priced = new Map<
          string,
          { name: string; unit: string; unitPrice: number; buyPriceSnapshot: number | null }
        >();
        for (const item of dto.items) {
          if (item.kind === 'service') {
            const svc = await tx.service.findUnique({ where: { id: item.refId } });
            if (!svc || !svc.active) throw new BadRequestException('Jasa tidak ditemukan/nonaktif');
            priced.set(lineKey(item), { name: svc.name, unit: 'jasa', unitPrice: Number(svc.basePrice), buyPriceSnapshot: null });
          } else if (item.kind === 'product') {
            const locked = stockResults.get(lineKey(item))!;
            priced.set(lineKey(item), { name: locked.name, unit: locked.unit, unitPrice: locked.unitPrice, buyPriceSnapshot: locked.buyPrice });
          } else {
            const locked = stockResults.get(lineKey(item))!;
            // Koreksi 2026-09-08 — findFirst, bukan findUnique/kind_refId.
            const cost = await tx.itemCost.findFirst({ where: { kind: 'sparepart', refId: item.refId } });
            priced.set(lineKey(item), { ...locked, buyPriceSnapshot: cost ? Number(cost.buyPrice) : null });
          }
        }

        // Cek "jual di bawah modal" — CUMA buat kind='product'. Dicek di
        // titik ini (sebelum voucher/transaction/invoice dibuat) biar kalau
        // ke-abort gara-gara warning, kerjaan yang udah kepake (lock voucher,
        // dst) seminimal mungkin. Kalau ke-abort, SEMUA yang udah kejalan di
        // atas (termasuk member.findOrCreate & lock stok) ikut ROLLBACK
        // otomatis karena masih di dalam $transaction yang sama.
        const belowCostWarnings: BelowCostWarning[] = [];
        for (const item of dto.items) {
          if (item.kind !== 'product') continue;
          const p = priced.get(lineKey(item))!;
          const buyPrice = p.buyPriceSnapshot ?? 0;
          const { isBelowCost, effectivePrice } = checkBelowCost({
            buyPrice,
            sellPrice: p.unitPrice,
            discount: item.discount ?? 0,
          });
          if (isBelowCost) {
            belowCostWarnings.push({
              refId: item.refId,
              itemCostId: item.itemCostId!,
              name: p.name,
              buyPrice,
              sellPrice: p.unitPrice,
              discount: item.discount ?? 0,
              effectivePrice,
            });
          }
        }
        if (belowCostWarnings.length > 0 && !dto.confirmOverride) {
          throw new ConfirmationRequiredException(belowCostWarnings);
        }

        let voucherDiscountAmount = 0;
        let appliedClaim: { claimId: string; campaignName: string } | null = null;
        if (dto.voucherClaimId) {
          const itemsForVoucher = dto.items.map((i) => ({
            kind: i.kind,
            refId: i.refId,
            qty: i.qty,
            unitPrice: priced.get(lineKey(i))!.unitPrice,
          }));
          const result = await this.vouchers.lockAndValidateClaim(tx, dto.voucherClaimId, member.id, itemsForVoucher);
          voucherDiscountAmount = result.discountAmount;
          appliedClaim = { claimId: result.claimId, campaignName: result.campaignName };
        }
        const totalDiscount = (dto.discount ?? 0) + voucherDiscountAmount;

        const totals = computeTotals(
          [
            ...dto.items.map((i) => ({ qty: i.qty, unitPrice: priced.get(lineKey(i))!.unitPrice, discount: i.discount ?? 0 })),
            ...packageLines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
          ],
          totalDiscount,
          dto.taxPercent ?? 0,
          dto.transportFee ?? 0,
        );
        if (totalDiscount > totals.subtotal) {
          throw new BadRequestException('Total diskon (ad-hoc + voucher) melebihi subtotal');
        }

        const transaction = await tx.transaction.create({
          data: {
            memberId: member.id,
            customerName: dto.customer.name,
            customerPhone: member.phone,
            subtotal: totals.subtotal,
            discount: totalDiscount,
            taxPercent: dto.taxPercent ?? 0,
            taxAmount: totals.taxAmount,
            transportFee: dto.transportFee ?? 0,
            grandTotal: totals.grandTotal,
            notes: dto.notes,
            createdById: actorId,
          },
        });

        for (const item of dto.items) {
          const p = priced.get(lineKey(item))!;
          const itemDiscount = item.discount ?? 0;
          const lineTotal = Math.round(item.qty * p.unitPrice) - itemDiscount;
          await tx.transactionItem.create({
            data: {
              transactionId: transaction.id,
              kind: item.kind,
              refId: item.refId,
              name: p.name,
              unit: p.unit,
              qty: item.qty,
              unitPrice: p.unitPrice,
              lineTotal,
              discount: itemDiscount,
            },
          });
          if (item.kind !== 'service') {
            await tx.stockMovement.create({
              data: {
                itemKind: item.kind,
                refId: item.refId,
                name: p.name,
                qtyChange: -item.qty,
                reason: 'penjualan',
                transactionId: transaction.id,
                createdById: actorId,
                itemCostId: item.kind === 'product' ? item.itemCostId : undefined,
              },
            });
          }
        }

        for (const line of packageLines) {
          const lineTotal = Math.round(line.qty * line.unitPrice);
          await tx.transactionItem.create({
            data: {
              transactionId: transaction.id,
              kind: 'installation_package_item',
              refId: line.sparepartId,
              name: line.name,
              unit: line.unit,
              qty: line.qty,
              unitPrice: line.unitPrice,
              lineTotal,
            },
          });
          if (line.sparepartId) {
            await tx.stockMovement.create({
              data: {
                itemKind: 'sparepart',
                refId: line.sparepartId,
                name: line.name,
                qtyChange: -line.qty,
                reason: 'pemakaian_instalasi',
                transactionId: transaction.id,
                createdById: actorId,
              },
            });
          }
        }

        const dateKey = this.counters.dateKey(now);
        const invoiceSeq = await this.counters.nextSeq(tx, `invoice_${dateKey}`);
        const invoice = await tx.invoice.create({
          data: {
            number: formatInvoiceNumber(dateKey, invoiceSeq),
            transactionId: transaction.id,
            memberId: member.id,
            customerName: dto.customer.name,
            customerPhone: member.phone,
            subtotal: totals.subtotal,
            discount: totalDiscount,
            taxPercent: dto.taxPercent ?? 0,
            taxAmount: totals.taxAmount,
            transportFee: dto.transportFee ?? 0,
            grandTotal: totals.grandTotal,
            totalPaid: 0,
            status: computeInvoiceStatus(totals.grandTotal, 0),
            notes: dto.notes,
            createdById: actorId,
          },
        });

        for (const item of dto.items) {
          const p = priced.get(lineKey(item))!;
          const itemDiscount = item.discount ?? 0;
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              kind: item.kind,
              refId: item.refId,
              name: p.name,
              unit: p.unit,
              qty: item.qty,
              unitPrice: p.unitPrice,
              lineTotal: Math.round(item.qty * p.unitPrice) - itemDiscount,
              discount: itemDiscount,
              buyPriceSnapshot: p.buyPriceSnapshot,
            },
          });
        }
        for (const line of packageLines) {
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              kind: 'installation_package_item',
              refId: line.sparepartId,
              name: line.name,
              unit: line.unit,
              qty: line.qty,
              unitPrice: line.unitPrice,
              lineTotal: Math.round(line.qty * line.unitPrice),
              buyPriceSnapshot: line.buyPriceSnapshot,
            },
          });
        }
        if ((dto.discount ?? 0) > 0) {
          await tx.invoiceAdjustment.create({
            data: { invoiceId: invoice.id, amount: dto.discount!, reason: dto.discountReason!, createdById: actorId },
          });
        }
        if (appliedClaim) {
          await tx.invoiceAdjustment.create({
            data: { invoiceId: invoice.id, amount: voucherDiscountAmount, reason: `Voucher: ${appliedClaim.campaignName}`, createdById: actorId },
          });
          await tx.voucherClaim.update({
            where: { id: appliedClaim.claimId },
            data: { status: 'dipakai', usedAt: now, invoiceId: invoice.id },
          });
        }

        let serviceOrderId: string | null = null;
        const installedUnits: { unitId: string; barcodeValue: string; roomLocation: string | null }[] = [];
        if (dto.installations?.length) {
          const order = await tx.serviceOrder.create({
            data: { memberId: member.id, transactionId: transaction.id, invoiceId: invoice.id, type: 'pemasangan', status: 'terjadwal', createdById: actorId },
          });
          serviceOrderId = order.id;

          for (let idx = 0; idx < dto.installations.length; idx++) {
            const inst = dto.installations[idx];
            const item = dto.items[inst.itemIndex];
            if (!item || item.kind !== 'product') {
              throw new BadRequestException('itemIndex instalasi harus menunjuk item bertipe product');
            }
            const productData = await tx.product.findUnique({ where: { id: item.refId } });
            if (!productData) throw new BadRequestException(`Produk ${item.refId} tidak ditemukan saat proses instalasi`);
            const unit = await this.acUnits.createForInstallation(tx, member.id, productData, inst.roomLocation);
            installedUnits.push({ unitId: unit.id, barcodeValue: unit.barcodeValue, roomLocation: unit.roomLocation });
            await tx.serviceOrderUnit.create({ data: { orderId: order.id, unitId: unit.id, status: 'menunggu_pemasangan' } });
            await this.technicianJobs.createForOrder(tx, {
              orderId: order.id,
              memberId: member.id,
              unitId: unit.id,
              technicianId: inst.technicianId ?? null,
              type: 'pemasangan',
              actorId,
            });
          }
          await tx.member.update({ where: { id: member.id }, data: { totalAcUnits: { increment: dto.installations.length } } });
        }

        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'pos.checkout',
            target: invoice.id,
            detail: {
              number: invoice.number,
              grandTotal: totals.grandTotal,
              voucherApplied: appliedClaim?.campaignName ?? null,
              installationPackagesUsed: packageIds.length,
              belowCostOverride: belowCostWarnings.length > 0 || undefined,
            },
          },
        });

        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          transactionId: transaction.id,
          memberId: member.id,
          serviceOrderId,
          installedUnits,
          voucherDiscountAmount: appliedClaim ? voucherDiscountAmount : undefined,
        };
      });
      return { status: 'ok' as const, ...result };
    } catch (err) {
      if (err instanceof ConfirmationRequiredException) {
        return { status: 'confirm_required' as const, warnings: err.warnings };
      }
      throw err;
    }
  }
}
```

- [ ] **Step 2: Build TypeScript**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: gak ada error dari `pos.service.ts`. (Kalau ada error `CheckoutItemDto` gak ke-export — cek Task 7 udah nge-export `CheckoutItemDto`, bukan cuma `CheckoutDto`.)

- [ ] **Step 3: Commit**

```bash
git add src/pos/pos.service.ts
git commit -m "feat(pos): checkout pilih-batch produk, diskon per-item, warning harga di bawah modal"
```

---

### Task 10: `PosController` — Jangan Broadcast Realtime Kalau Cuma Warning

**Files:**
- Modify: `src/pos/pos.controller.ts`

- [ ] **Step 1: Guard `emitToAdmin` cuma pas checkout beneran sukses**

`src/pos/pos.controller.ts` (replace seluruh file):
```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PosService } from './pos.service';
import { CheckoutDto } from './dto/checkout.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pos')
export class PosController {
  constructor(
    private readonly posService: PosService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Roles('admin', 'kasir')
  @Post('checkout')
  async checkout(@Body() dto: CheckoutDto, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.posService.checkout(dto, user.sub);
    // Siklus batch-cost (2026-09): checkout bisa balik {status:'confirm_required'}
    // tanpa transaksi kebentuk sama sekali — jangan broadcast "transaction.created"
    // buat kasus itu, cuma pas beneran sukses (status:'ok').
    if (result.status === 'ok') {
      this.realtime.emitToAdmin('transaction.created', result);
    }
    return result;
  }
}
```

- [ ] **Step 2: Build TypeScript**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: gak ada error dari `pos.controller.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/pos/pos.controller.ts
git commit -m "fix(pos): jangan broadcast realtime kalau checkout cuma balikin warning"
```

---

### Task 11: `Products` — DTO, Agregat Harga/Stok, Endpoint List Batch

**Files:**
- Modify: `src/products/dto/create-product.dto.ts`
- Modify: `src/products/dto/update-product.dto.ts`
- Modify: `src/products/products.service.ts`
- Modify: `src/products/products.controller.ts`

- [ ] **Step 1: Hapus `sellPrice`/`stock` dari `CreateProductDto`**

`src/products/dto/create-product.dto.ts` (replace seluruh file):
```ts
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() name: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsBoolean() inverter?: boolean;
  @IsOptional() @IsInt() btu?: number;
  @IsOptional() @IsInt() watt?: number;
  @IsOptional() @IsString() category?: string;
  // sellPrice & stock DIHAPUS (Siklus batch-cost 2026-09) — harga jual &
  // stok sekarang selalu datang dari batch (item_costs), diisi lewat
  // StockService.stockIn() SETELAH produk ini dibuat. Produk baru mulai
  // dengan 0 batch/0 stok sampai di-stock-in.
}
```

- [ ] **Step 2: Hapus `sellPrice` dari `UpdateProductDto`**

`src/products/dto/update-product.dto.ts` (replace seluruh file):
```ts
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// Field yang sama seperti CreateProductDto, semua opsional (PATCH parsial)
// KECUALI `stock` DAN (Siklus batch-cost 2026-09) `sellPrice` — dua-duanya
// udah gak ada lagi di tabel `products` (pindah ke `item_costs` per-batch).
// Satu-satunya jalur ubah harga jual sekarang StockService.stockIn() (bikin
// batch baru) — biar tiap perubahan harga/stok selalu ninggalin jejak
// StockMovement/batch, gak ada 2 jalur mutasi yang gak sinkron.
export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsBoolean() inverter?: boolean;
  @IsOptional() @IsInt() btu?: number;
  @IsOptional() @IsInt() watt?: number;
  @IsOptional() @IsString() warranty?: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

- [ ] **Step 3: `ProductsService` — agregat harga/stok + list batch**

`src/products/products.service.ts` (replace seluruh file):
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

interface ProductPriceAgg {
  totalStock: number;
  sellPriceMin: number | null;
  sellPriceMax: number | null;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
  ) {}

  create(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      const seq = await this.counters.nextSeq(tx, 'product_sku');
      const sku = `PRD-${String(seq).padStart(4, '0')}`;
      return tx.product.create({ data: { ...dto, sku, active: true } });
    });
  }

  /** Harga & stok produk sekarang agregat dari batch aktif (item_costs,
   * kind='product', stock>0) — Siklus batch-cost 2026-09. */
  private async priceAggFor(productIds: string[]): Promise<Map<string, ProductPriceAgg>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      { ref_id: string; total_stock: string; min_price: string; max_price: string }[]
    >`
      SELECT ref_id, SUM(stock) AS total_stock, MIN(sell_price) AS min_price, MAX(sell_price) AS max_price
      FROM item_costs
      WHERE kind = 'product' AND stock > 0 AND ref_id = ANY(${productIds})
      GROUP BY ref_id
    `;
    return new Map(
      rows.map((r) => [r.ref_id, { totalStock: Number(r.total_stock), sellPriceMin: Number(r.min_price), sellPriceMax: Number(r.max_price) }]),
    );
  }

  async findAll() {
    const products = await this.prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    const agg = await this.priceAggFor(products.map((p) => p.id));
    return products.map((p) => {
      const a = agg.get(p.id);
      return { ...p, stock: a?.totalStock ?? 0, sellPriceMin: a?.sellPriceMin ?? null, sellPriceMax: a?.sellPriceMax ?? null };
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');
    const agg = await this.priceAggFor([id]);
    const a = agg.get(id);
    return { ...product, stock: a?.totalStock ?? 0, sellPriceMin: a?.sellPriceMin ?? null, sellPriceMax: a?.sellPriceMax ?? null };
  }

  /** List batch aktif (stock>0) 1 produk — dipakai dialog pemilihan batch
   * di POS & referensi harga pas stock-in lagi. Urut TERTUA dulu (konsisten
   * sama urutan FIFO di StockLockingService.lockAndDeduct). */
  async findBatches(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');
    return this.prisma.itemCost.findMany({
      where: { kind: 'product', refId: productId, stock: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, dto: UpdateProductDto, actorId: string) {
    if (Object.keys(dto).length === 0) throw new BadRequestException('Gak ada perubahan yang dikirim');
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Produk tidak ditemukan');

    const product = await this.prisma.product.update({ where: { id }, data: dto });

    await this.prisma.auditLog.create({
      data: { actorUid: actorId, action: 'product.update', target: id, detail: { ...dto } as Prisma.InputJsonValue },
    });

    return product;
  }
}
```

- [ ] **Step 4: `ProductsController` — endpoint list batch**

Di `src/products/products.controller.ts`, tambahkan method baru setelah `findOne`:
```ts
  @Get(':id/batches')
  findBatches(@Param('id') id: string) {
    return this.products.findBatches(id);
  }
```

- [ ] **Step 5: Verifikasi manual**

```bash
curl http://localhost:3000/products -H "Authorization: Bearer $TOKEN" | head -c 300
```
Expected: tiap produk ada field `stock`, `sellPriceMin`, `sellPriceMax` (bukan lagi `sellPrice` tunggal).

```bash
curl http://localhost:3000/products/$PRODUCT_ID/batches -H "Authorization: Bearer $TOKEN"
```
Expected: array baris `item_costs` (id, supplierName, buyPrice, sellPrice, stock) buat produk itu, urut created_at ASC.

- [ ] **Step 6: Commit**

```bash
git add src/products/
git commit -m "feat(products): agregat harga/stok dari batch, endpoint list batch produk"
```

---

### Task 12: `ReportsService.profitLoss()` — Fallback Rata-Rata (Bukan Join Mentah)

**Files:**
- Modify: `src/reports/reports.service.ts` (query di method `profitLoss`)

**Kenapa ini WAJIB diubah, bukan opsional:** query lama `LEFT JOIN item_costs ic ON ic.kind = ii.kind AND ic.ref_id = ii.ref_id` asumsi max 1 baris `item_costs` per `(kind, refId)`. Sekarang `kind='product'` bisa punya BANYAK baris (batch) — join mentah kayak gitu bakal GANDAIN baris di agregasi SQL (SUM ke-kali jumlah batch), bikin laporan HPP transaksi lama meledak salah. Harus di-average dulu di subquery SEBELUM di-join.

- [ ] **Step 1: Ganti query di `profitLoss`**

Di `src/reports/reports.service.ts`, method `profitLoss`, cari blok `$queryRaw` yang isinya `LEFT JOIN item_costs ic ON ic.kind = ii.kind AND ic.ref_id = ii.ref_id`. Ganti SELURUH raw SQL itu jadi:
```ts
    const lines = await this.prisma.$queryRaw<
      {
        kind: string;
        ref_id: string | null;
        name: string;
        qty_sold: string;
        revenue: string;
        cogs: string;
        baris_barang: string;
        baris_tanpa_snapshot: string;
        baris_tanpa_hpp_sama_sekali: string;
      }[]
    >`
      SELECT ii.kind, ii.ref_id, ii.name,
             SUM(ii.qty) AS qty_sold,
             SUM(ii.line_total) AS revenue,
             SUM(ii.qty * COALESCE(ii.buy_price_snapshot, ic.buy_price, 0)) AS cogs,
             COUNT(*) FILTER (WHERE ii.kind != 'service') AS baris_barang,
             COUNT(*) FILTER (WHERE ii.kind != 'service' AND ii.buy_price_snapshot IS NULL) AS baris_tanpa_snapshot,
             COUNT(*) FILTER (WHERE ii.kind != 'service' AND ii.buy_price_snapshot IS NULL AND ic.buy_price IS NULL) AS baris_tanpa_hpp_sama_sekali
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN (
        -- Siklus batch-cost (2026-09): item_costs sekarang bisa banyak
        -- baris per (kind, ref_id) buat kind='product' (per-batch). Fallback
        -- HPP transaksi LAMA (buy_price_snapshot null) pakai RATA-RATA harga
        -- modal batch yang MASIH AKTIF (stock>0) buat refId itu — bukan join
        -- mentah (bakal gandain baris SUM di atas kalau langsung join
        -- item_costs tanpa di-agregat dulu di sini).
        SELECT kind, ref_id, AVG(buy_price) AS buy_price
        FROM item_costs
        WHERE stock > 0
        GROUP BY kind, ref_id
      ) ic ON ic.kind = ii.kind AND ic.ref_id = ii.ref_id
      WHERE i.created_at BETWEEN ${start} AND ${end}
      GROUP BY ii.kind, ii.ref_id, ii.name
      ORDER BY revenue DESC
    `;
```

Update juga komentar dokumentasi di atas method (paragraf yang jelasin `item_costs.buy_price` sebagai fallback) — tambahkan 1 kalimat:
```ts
   * (Siklus batch-cost 2026-09: `item_costs.buy_price` fallback ini
   * sekarang RATA-RATA dari semua batch aktif per refId, bukan 1 nilai
   * tunggal — karena item_costs bisa punya banyak baris per produk.)
```

- [ ] **Step 2: Verifikasi manual**

Cari 1 produk dengan >1 batch aktif harga beda (dari Task 11 batches endpoint), lalu:
```bash
curl "http://localhost:3000/reports/profit-loss?from=2020-01-01&to=2030-01-01" -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -m json.tool | grep -A 8 "\"refId\": \"$PRODUCT_ID\""
```
Expected: `hpp` buat baris invoice LAMA (yang `buyPriceSnapshot`-nya null) itungannya masuk akal (qty × rata-rata buyPrice batch aktif), BUKAN kelipatan aneh dari jumlah batch.

- [ ] **Step 3: Commit**

```bash
git add src/reports/reports.service.ts
git commit -m "fix(reports): fallback HPP profitLoss pakai rata-rata batch, hindari row-multiplication"
```

---

### Task 13: Safety Net — Cari Sisa Referensi `products.sellPrice`/`products.stock`

**Files:** (gak ada file spesifik — ini task verifikasi lintas-codebase)

- [ ] **Step 1: Grep referensi yang mungkin ketinggalan**

Run:
```bash
grep -rn "\.sellPrice\b" src --include="*.ts" | grep -v -E "sellPriceMin|sellPriceMax|CheckoutItemDto|item_costs|itemCost\.|batch"
```
Expected: kosong, atau kalau ada hasil, PERIKSA satu-satu — kemungkinan ada file yang belum ke-cover plan ini (mis. serializer/response DTO lain yang belum ketemu pas mapping awal).

Run:
```bash
grep -rn "products\.stock\|product\.stock\b\|FROM products.*stock\|SET stock.*products" src --include="*.ts"
```
Expected: kosong (semua query stok produk sekarang harusnya lewat `item_costs`).

Run:
```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: TIDAK ada error TypeScript sama sekali (LayoutProps-style pre-existing errors gak relevan di backend — itu cuma di frontend Next.js). Kalau ada error nyisa yang nunjuk field `sellPrice`/`stock` di `Product`, itu tandanya ada file yang belum diupdate — perbaiki sebelum lanjut.

- [ ] **Step 2: Kalau ketemu file yang belum ke-cover, catat & perbaiki**

Kalau step 1 nemu hits yang genuinely butuh perbaikan (bukan false-positive), perbaiki file itu mengikuti pola yang sama kayak Task 11 (baca stok/harga dari `item_costs`, bukan `products`), lalu commit terpisah dengan pesan yang jelas nyebut file yang ketinggalan.

**CATATAN (ditemukan pas eksekusi 2026-09-08):** Step 1 nemu 1 hit nyata yang genuinely ketinggalan — `src/material-requests/material-requests.service.ts`, method `priceItems()`, cabang `kind==='product'` masih baca `p.sellPrice` dari `Product` (field itu udah dihapus di Task 1). Diperbaiki: harga produk buat pengajuan material sekarang diambil dari batch AKTIF TERTUA (`item_costs` `kind='product'`, `stock>0`, `orderBy createdAt asc`) — bukan rata-rata/MIN/MAX — biar konsisten sama urutan FIFO yang beneran dipakai `StockLockingService.lockAndDeduct` pas `markUsed()` motong stok. Kalau gak ada batch aktif sama sekali, lempar `BadRequestException`. (Hit sparepart `sp.sellPrice` di file yang sama itu AMAN/false-positive — `Sparepart.sellPrice` gak kena Siklus batch-cost, tetap di tabel `spareparts`.)

- [ ] **Step 3: Commit (kalau ada perbaikan tambahan)**

```bash
git add -A
git commit -m "fix: bereskan sisa referensi products.sellPrice/stock yang ketinggalan"
```

(Skip commit ini kalau step 1 udah bersih dari awal.)

---

### Task 14: Verifikasi Akhir

**Files:** (gak ada file spesifik)

- [ ] **Step 1: Full test suite**

Run: `npx jest`
Expected: semua test PASS (termasuk semua test baru dari Task 2, 3, 8).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: build sukses, gak ada error.

- [ ] **Step 3: Checklist verifikasi manual end-to-end** (butuh server + DB nyata jalan)

1. `POST /stock/in` produk baru dengan `sellPrice > buyPrice` → sukses langsung, `item_costs` nambah 1 batch.
2. `POST /stock/in` produk dengan `sellPrice <= buyPrice`, tanpa `confirmOverride` → `status:'confirm_required'`, gak ada batch baru kesimpen.
3. `POST /stock/in` ulang dengan `confirmOverride:true` → `status:'ok'`, batch baru kesimpen.
4. `GET /products/:id/batches` nunjukin 2+ batch kalau produk itu di-stock-in 2x dengan harga beda.
5. `POST /pos/checkout` pilih `itemCostId` dari batch yang harga jualnya di atas modal → `status:'ok'` langsung.
6. `POST /pos/checkout` pilih `itemCostId` dengan `discount` yang bikin harga efektif <= modal batch itu → `status:'confirm_required'`, TIDAK ada invoice/transaction kebentuk (cek `SELECT COUNT(*) FROM invoices` sebelum-sesudah, harus sama).
7. Checkout ulang persis sama + `confirmOverride:true` → `status:'ok'`, stok batch berkurang, `invoice_items.discount` & `buy_price_snapshot` keisi bener.
8. **(DIREVISI 2026-09-08 — kind='product' dicabut dari scope pengajuan material, lihat diskusi setelah Task 13)** `POST /technician-jobs/:jobId/materials` dengan item `kind:'product'` → HARUS ke-reject 400 (class-validator `@IsIn(['sparepart'])`), BUKAN sukses. `kind:'sparepart'` di jalur yang sama tetap harus sukses normal (`markUsed()` tetap motong stok FIFO sparepart seperti biasa, verifikasi fix Task 3 gak regresi jalur ini).
9. `POST /stock/opname` produk dengan `itemCostId` spesifik → cuma batch itu yang berubah stoknya, batch lain produk yang sama gak kesenggol.
10. `GET /reports/profit-loss` gak error & angkanya masuk akal buat produk multi-batch. **Cek juga baris sparepart LAMA (`buy_price_snapshot` null)** — HPP-nya harus keisi dari `item_costs.buy_price` sparepart itu (BUKAN 0) — ini nutup bug row-multiplication + HPP-ke-nol yang ketemu review 2026-09-08.
11. **(BARU)** `npx jest` full suite pass tanpa gagal (butuh `dotenv/config` di jest `setupFiles` — ketemu gap pas verifikasi 2026-09-08, `.env` sebelumnya cuma ke-load pas app start normal lewat `main.ts`, bukan pas Jest jalan).

- [ ] **Step 4: Update spec doc — tandai status "Selesai diimplementasi"**

Di `docs/superpowers/specs/2026-09-08-checkout-batch-cost-warning-design.md`, ubah baris `**Status:** Disetujui user, siap masuk implementation plan` jadi `**Status:** Backend selesai diimplementasi (2026-09-08). FE POS menyusul di plan terpisah.`

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-08-checkout-batch-cost-warning-design.md
git commit -m "docs: tandai spec batch-cost warning — backend selesai"
```

---

## Self-Review (dicatat di sini, bukan bagian tugas engineer)

**Cakupan spec:** §4 (keputusan desain) ✅ semua 9 poin ke-cover Task 1-11. §5 (data model) ✅ Task 1. §6 (stock-in) ✅ Task 4-5. §7 (checkout) ✅ Task 7-9. §9 (laporan) ✅ Task 12. §10 (migrasi data lama) ✅ Task 1 Step 5. §11 (edge case rebutan batch/produk tanpa batch/2-baris-1-produk) ✅ tercakup lewat `FOR UPDATE` (Task 3) & `lineKey` (Task 9). §8 (FE) — SENGAJA di luar scope plan ini (dijadiin plan terpisah, sesuai keputusan "backend dulu").

**Temuan tambahan di luar spec awal (ditemukan & dikonfirmasi user pas mapping file):** `MaterialRequestsService` & `StockService.opname()` sama-sama bakal rusak kalau `products.sellPrice/stock` dihapus tanpa fix — sudah masuk Task 3 & 6 dengan persetujuan user (jalur FIFO otomatis buat material-request, per-batch buat opname).

**Placeholder scan:** gak ada "TBD"/"TODO" — semua step punya kode lengkap atau perintah+expected-output konkret.

**Konsistensi tipe:** `lineKey()` dipakai konsisten di semua Map (`seen`, `demand`, `stockResults`, `priced`) di Task 9. `BelowCostWarning` (Task 2) dipakai identik oleh `PosService` (Task 9) & `StockService` (Task 5). `ConfirmationRequiredException` & `{status:'ok'|'confirm_required'}` response shape konsisten di 2 tempat (Task 5, Task 9) + controller guard (Task 10).
