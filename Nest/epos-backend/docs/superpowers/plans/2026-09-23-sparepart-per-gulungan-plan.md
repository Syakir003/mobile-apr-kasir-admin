# Sparepart Per-Gulungan (Point 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sparepart yang dijual per-meter (pipa, kabel, dst) bisa dilacak per-gulungan (banyak `ItemCost` batch per sparepart, kayak Produk), sementara sparepart lain tetap flat-stock kayak sekarang — admin yang milih lewat toggle `batchTracked` per sparepart.

**Architecture:** Sparepart dapet kolom `batchTracked` (default `false`). Kalau `true`, sparepart itu numpang di infrastruktur batch `ItemCost` yang sama kayak Produk (FIFO checkout/pemakaian, N baris per barang-masuk). `Sparepart.stock` TETAP kolom flat yang dibaca langsung banyak tempat (list/detail Master Data, picker Barang Masuk) — buat sparepart `batchTracked=true`, kolom ini jadi MIRROR yang di-sync manual di TIAP mutasi (barang masuk, checkout, pengajuan material, opname), bukan dihitung ulang tiap read kayak `Product.stock`. `ItemCost.stock` berubah tipe `Int` → `Decimal(10,2)` (supaya bisa nyimpen sisa meter pecahan) — ini kolom SAMA yang dipakai batch Produk, jadi perubahan tipe ini berefek ke kode FIFO Produk juga (raw SQL `NUMERIC` balik sebagai string dari `node-pg`, bukan `number` kayak `INTEGER` — semua tempat yang baca `batch.stock` mentah dari `$queryRawUnsafe` wajib di-`Number()`-in ulang).

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend), Next.js App Router + React Query + react-hook-form + zod (frontend) — sama kayak Point 1.

**Keputusan desain kunci (biar gak diulang-ulang di tiap task):**

1. **`Sparepart.stock` tetap kolom flat live-synced**, BUKAN computed-aggregate kayak `Product.stock`. Alasan: `SparepartsService.findAll/search` (dipakai `master/sparepart/page.tsx`, `stock-client.tsx` picker, `sparepart-detail-client.tsx`, `MaterialRequestsService.priceItems`) semuanya baca `sparepart.stock` LANGSUNG dari row Prisma tanpa agregasi — beda dari Produk yang dari awal emang gak punya kolom `stock` sendiri. Kalau dibikin computed-aggregate kayak Produk, SEMUA tempat itu harus diubah. Live-sync jauh lebih kecil blast radius-nya.
2. **Bug lama `unit: 'pcs'` hardcoded** di `StockLockingService.lockAndDeduct` cabang sparepart (harusnya baca `sparepart.unit` asli — 'meter', 'kg', dst) DIPERBAIKI di task ini, karena Point 3 ini justru tentang sparepart meteran — bug ini bakal keliatan jelas banget di invoice pipa/kabel kalau gak dibenerin sekalian.
3. **`MaterialRequestsService.markUsed()`** disamain polanya kayak `PosService` (Task 5 Point 1) — loop `batchDeductions` per item, bikin `StockMovement` PER BATCH, bukan 1 baris gabungan.
4. **`PosService.checkout`** — sparepart batch-tracked yang KEBETULAN dipakai bareng di cart (`dto.items`) DAN di paket instalasi (`dto.installations` → `packageLines`) buat sparepart yang SAMA, di-gabung jadi SATU kebutuhan (`demand` map, kode existing) lalu di-FIFO SEKALI. Biar histori `StockMovement` tetap presisi per-batch per-baris (bukan cuma per-refId), dipisah balik pakai helper murni `allocateBatchDeductions` (Task 3) — bukan restrukturisasi total `checkout()`.
5. **Toggle `batchTracked`** bisa diubah admin kapan aja (create ATAU edit) — TIDAK ada migrasi data otomatis pas di-toggle. Kalau di-flip `true`→`false` pas masih ada batch `item_costs` aktif, baris2 itu jadi "orphan" (gak kepakai lagi, gak ganggu — `stock` mirror tetap akurat karena udah di-sync dari awal). Ini keputusan sadar, bukan bug — dicatat di komentar kode.

---

### Task 1: Schema — `Sparepart.batchTracked` + `ItemCost.stock` Int→Decimal

**Files:**
- Modify: `prisma/schema.prisma:177-192` (model `Sparepart`)
- Modify: `prisma/schema.prisma:244-257` (model `ItemCost`)
- Create: `prisma/migrations/20260923000000_sparepart_batch_tracking/migration.sql`

- [ ] **Step 1: Tambah kolom `batchTracked` di model `Sparepart`**

Ganti blok `model Sparepart { ... }` (baris 177-192) jadi:

```prisma
model Sparepart {
  id           String   @id @default(uuid())
  name         String
  sku          String?  @unique
  category     String?
  unit         String // 'kg', 'meter', 'pcs', 'set', dll
  sellPrice    Decimal  @map("sell_price") @db.Decimal(14, 2)
  // Siklus sparepart-per-gulungan (2026-09-23) — kolom ini TETAP satu-
  // satunya sumber stok yang dibaca langsung (SparepartsService, halaman
  // Master Data & Barang Masuk, MaterialRequestsService.priceItems) —
  // BEDA dari Product.stock yang computed-aggregate dari item_costs.
  // Buat sparepart batchTracked=true, kolom ini jadi MIRROR yang disinkron
  // manual di StockService.stockIn/opname, StockLockingService.lockAndDeduct,
  // dan MaterialRequestsService.markUsed — TIAP tempat yang nge-decrement/
  // increment item_costs.stock buat kind='sparepart' WAJIB nge-decrement/
  // increment kolom ini juga di baris yang sama (row sparepart udah kekunci
  // FOR UPDATE di semua tempat itu, jadi aman dari race).
  stock        Decimal  @db.Decimal(10, 2)
  minStock     Decimal  @default(0) @map("min_stock") @db.Decimal(10, 2)
  // BARU — admin toggle per sparepart (create ATAU edit). true = sparepart
  // ini dilacak per-gulungan/batch (banyak baris item_costs sekaligus, FIFO
  // kayak Produk) — biasanya buat barang yang dijual per-meter/panjang
  // (pipa, kabel) yang tiap kedatangan panjangnya beda-beda. false (default)
  // = sparepart flat biasa, gak berubah dari sebelum siklus ini.
  //
  // Nge-toggle field ini TIDAK migrasi data item_costs yang udah ada — kalau
  // di-flip true->false pas masih ada batch aktif, batch2 itu jadi orphan
  // (gak kepakai lagi FIFO, tapi `stock` mirror di atas tetap akurat karena
  // udah disinkron dari awal). Keputusan sadar, bukan bug.
  batchTracked Boolean  @default(false) @map("batch_tracked")
  active       Boolean  @default(true)
  createdAt    DateTime @default(now()) @map("created_at")

  packageItems InstallationPackageItem[]

  @@map("spareparts")
}
```

- [ ] **Step 2: Ubah tipe `ItemCost.stock` dari `Int` ke `Decimal`**

Ganti blok `model ItemCost { ... }` (baris 244-257) jadi:

```prisma
model ItemCost {
  id           String   @id @default(uuid())
  kind         String // 'product' | 'sparepart'
  refId        String   @map("ref_id")
  supplierName String?  @map("supplier_name")
  buyPrice     Decimal  @map("buy_price") @db.Decimal(14, 2)
  sellPrice    Decimal  @map("sell_price") @db.Decimal(14, 2)
  // Siklus sparepart-per-gulungan (2026-09-23) — Int -> Decimal. Kolom ini
  // sisa stok BATCH ini: buat kind='product' tetap bilangan bulat (cuma
  // ganti tipe kolom DB, nilai efektifnya selalu utuh — validasi qty produk
  // masih @IsQtyValidForKind maksa integer). Buat kind='sparepart' YANG
  // batchTracked=true, kolom ini nyimpen SISA PANJANG (meter) gulungan itu,
  // bisa pecahan. Buat kind='sparepart' yang batchTracked=false, kolom ini
  // tetap 0/gak dipakai (placeholder lama, gak berubah).
  //
  // GOTCHA node-pg: kolom NUMERIC/DECIMAL balik sebagai STRING lewat
  // $queryRawUnsafe (beda dari INTEGER yang auto-parse ke `number`). Semua
  // kode yang baca `stock` mentah dari raw query WAJIB eksplisit `Number()`
  // sekarang — lihat StockLockingService & StockService.opname (Task 2 & 6).
  stock        Decimal  @db.Decimal(10, 2)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([kind, refId])
  @@map("item_costs")
}
```

- [ ] **Step 3: Bikin migration SQL manual**

Bikin `prisma/migrations/20260923000000_sparepart_batch_tracking/migration.sql`:

```sql
-- Sparepart.batchTracked — default false, sparepart existing gak berubah perilaku.
ALTER TABLE "spareparts" ADD COLUMN "batch_tracked" BOOLEAN NOT NULL DEFAULT false;

-- ItemCost.stock Int -> Decimal(10,2). USING cast eksplisit biar Postgres
-- gak nolak (integer -> numeric aman, gak ada data loss, tapi Postgres tetap
-- minta USING kalau ALTER COLUMN TYPE lintas tipe non-trivial di beberapa versi).
ALTER TABLE "item_costs" ALTER COLUMN "stock" TYPE DECIMAL(10,2) USING "stock"::DECIMAL(10,2);
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260923000000_sparepart_batch_tracking/migration.sql
git commit -m "feat(db): tambah Sparepart.batchTracked, ItemCost.stock Int->Decimal"
```

---

### Task 2: `StockLockingService` — cabang sparepart batch-tracked + fix bug unit + fix parsing Decimal

**Files:**
- Modify: `src/common/services/stock-locking.service.ts` (rewrite penuh)
- Test: `src/common/services/stock-locking.service.spec.ts` (tambah test baru, TIDAK menghapus test existing kind='product')

- [ ] **Step 1: Tulis test baru buat cabang sparepart (flat DAN batch-tracked)**

Tambahkan `describe` block baru di akhir `stock-locking.service.spec.ts` (setelah `describe('StockLockingService.lockAndDeduct (kind=product)', ...)` yang udah ada, JANGAN dihapus):

```typescript
describe('StockLockingService.lockAndDeduct (kind=sparepart)', () => {
  it('flat (batchTracked=false) — potong langsung kolom spareparts.stock, unit dari row asli (bukan hardcode pcs)', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'Freon R32', active: true, unit: 'kg', batch_tracked: false, sell_price: '85000', stock: '10' }],
    ]);

    const result = await service.lockAndDeduct(tx, 'sparepart', 'sp-1', 3);

    expect(result).toEqual({
      name: 'Freon R32',
      unit: 'kg',
      unitPrice: 85000,
      buyPrice: null,
    });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE spareparts SET stock = stock - $1'),
      3,
      'sp-1',
    );
  });

  it('flat — lempar BadRequestException kalau stok kolom flat gak cukup', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'Freon R32', active: true, unit: 'kg', batch_tracked: false, sell_price: '85000', stock: '2' }],
    ]);
    await expect(service.lockAndDeduct(tx, 'sparepart', 'sp-1', 3)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('batch-tracked — FIFO lintas item_costs, unit dari row sparepart, buyPrice = MAX batch berstok, mirror spareparts.stock ikut kepotong', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'Pipa AC 1/4', active: true, unit: 'meter', batch_tracked: true, sell_price: '25000', stock: '15' }],
      [
        { id: 'roll-lama', stock: '4', buy_price: '18000' },
        { id: 'roll-baru', stock: '11', buy_price: '19000' },
      ],
    ]);

    const result = await service.lockAndDeduct(tx, 'sparepart', 'sp-pipa', 6);

    expect(result).toEqual({
      name: 'Pipa AC 1/4',
      unit: 'meter',
      unitPrice: 25000,
      buyPrice: 19000, // MAX(18000, 19000)
      batchDeductions: [
        { itemCostId: 'roll-lama', qty: 4 },
        { itemCostId: 'roll-baru', qty: 2 },
      ],
    });
    // 2 UPDATE item_costs (per roll kepotong) + 1 UPDATE spareparts (mirror).
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE item_costs SET stock = stock - $1'),
      4,
      'roll-lama',
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE item_costs SET stock = stock - $1'),
      2,
      'roll-baru',
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE spareparts SET stock = stock - $1'),
      6,
      'sp-pipa',
    );
  });

  it('batch-tracked — lempar BadRequestException kalau total stok semua roll gak cukup', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'Pipa AC 1/4', active: true, unit: 'meter', batch_tracked: true, sell_price: '25000', stock: '4' }],
      [{ id: 'roll-1', stock: '4', buy_price: '18000' }],
    ]);
    await expect(service.lockAndDeduct(tx, 'sparepart', 'sp-pipa', 10)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lempar BadRequestException kalau sparepart gak ketemu / nonaktif', async () => {
    const service = new StockLockingService();
    const txNotFound = fakeTxSequence([[]]);
    await expect(service.lockAndDeduct(txNotFound, 'sparepart', 'sp-x', 1)).rejects.toThrow(
      BadRequestException,
    );

    const txInactive = fakeTxSequence([
      [{ name: 'Freon R32', active: false, unit: 'kg', batch_tracked: false, sell_price: '85000', stock: '10' }],
    ]);
    await expect(service.lockAndDeduct(txInactive, 'sparepart', 'sp-1', 1)).rejects.toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL** (implementasi lama belum ngedukung `batch_tracked`/format baru)

Run: `npx jest stock-locking.service.spec.ts`
Expected: FAIL — test sparepart baru gagal (mismatch shape/query), test kind=product yang lama tetap harus PASS (belum disentuh).

- [ ] **Step 3: Rewrite `stock-locking.service.ts`**

Ganti ISI FILE PENUH jadi:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type StockKind = 'product' | 'sparepart';

export interface LockedItem {
  name: string;
  unit: string;
  unitPrice: number;
  // product & sparepart batchTracked=true: MAX(buyPrice) dari SEMUA batch
  // yang MASIH BERSTOK (skenario termahal, dipakai warning "jual di bawah
  // modal") — BUKAN cuma batch yang kena FIFO-deduct. sparepart flat: selalu
  // null (gak ada batch).
  buyPrice: number | null;
  // Diisi kalau kind='product' ATAU kind='sparepart' dengan batchTracked=
  // true — daftar batch (ItemCost) yang BENERAN kepotong stoknya lewat FIFO
  // (bisa lebih dari 1 kalau qty nembus beberapa batch/roll sekaligus).
  // Dipakai caller (PosService, MaterialRequestsService) buat bikin
  // StockMovement PER-BATCH, biar histori mutasi tetap presisi walau 1
  // baris cart/pengajuan bisa narik dari beberapa batch/roll.
  batchDeductions?: { itemCostId: string; qty: number }[];
}

/**
 * Port dari pola `FOR UPDATE` di checkout_transaction (pos_functions.sql,
 * baris ~308-336) dan mark_material_used (payment_approval_photo_rules.sql).
 * `FOR UPDATE` mengunci baris sampai transaksi commit/rollback. WAJIB
 * dipanggil di dalam Prisma interactive transaction (`$transaction`).
 */
@Injectable()
export class StockLockingService {
  /**
   * Kunci & kurangi stok.
   * - `product` — SELALU FIFO lintas batch `item_costs` (batch TERTUA
   *   duluan). Harga jual dari `Product.sellPrice` (seragam, Siklus
   *   harga-seragam 2026-09-22).
   * - `sparepart` DENGAN `batchTracked=false` — langsung potong kolom
   *   `spareparts.stock` (flat, perilaku lama, gak berubah).
   * - `sparepart` DENGAN `batchTracked=true` (Siklus sparepart-per-gulungan
   *   2026-09-23) — FIFO lintas batch `item_costs` SAMA POLA kayak produk,
   *   TAPI harga jual tetap dari `Sparepart.sellPrice` (satu harga per
   *   meter, BUKAN per-batch kayak produk — beda sengaja, lihat spec Point
   *   3). Kolom `spareparts.stock` (mirror) ikut dipotong di baris yang
   *   sama (row-nya udah kekunci FOR UPDATE di awal method ini).
   */
  async lockAndDeduct(
    tx: Prisma.TransactionClient,
    kind: StockKind,
    refId: string,
    qty: number,
  ): Promise<LockedItem> {
    if (kind === 'sparepart') {
      const rows = await tx.$queryRawUnsafe<
        {
          name: string;
          active: boolean;
          unit: string;
          batch_tracked: boolean;
          stock: unknown;
          sell_price: unknown;
        }[]
      >(
        `SELECT name, active, unit, batch_tracked, stock, sell_price FROM spareparts WHERE id = $1 FOR UPDATE`,
        refId,
      );

      const row = rows[0];
      if (!row) throw new BadRequestException(`Item sparepart ${refId} tidak ditemukan`);
      if (!row.active) throw new BadRequestException(`${row.name} tidak aktif`);

      if (!row.batch_tracked) {
        // Flat — perilaku lama, gak berubah (selain fix bug unit hardcode
        // 'pcs' di bawah, yang sekarang baca `row.unit` asli).
        if (Number(row.stock) < qty) {
          throw new BadRequestException(`Stok ${row.name} tidak cukup`);
        }
        await tx.$executeRawUnsafe(
          `UPDATE spareparts SET stock = stock - $1 WHERE id = $2`,
          qty,
          refId,
        );
        return { name: row.name, unit: row.unit, unitPrice: Number(row.sell_price), buyPrice: null };
      }

      // batchTracked=true — FIFO lintas item_costs, sama pola kayak produk.
      const batches = await tx.$queryRawUnsafe<
        { id: string; stock: unknown; buy_price: unknown }[]
      >(
        `SELECT id, stock, buy_price FROM item_costs
         WHERE kind = 'sparepart' AND ref_id = $1 AND stock > 0
         ORDER BY created_at ASC FOR UPDATE`,
        refId,
      );

      let remaining = qty;
      let maxBuyPrice: number | null = null;
      const batchDeductions: { itemCostId: string; qty: number }[] = [];
      for (const batch of batches) {
        // GOTCHA node-pg: item_costs.stock sekarang NUMERIC (Task 1), balik
        // sebagai string dari $queryRawUnsafe — wajib Number() eksplisit,
        // beda dari sebelum migrasi (INTEGER auto-parse ke number).
        const batchStock = Number(batch.stock);
        const buyPrice = Number(batch.buy_price);
        maxBuyPrice = maxBuyPrice === null ? buyPrice : Math.max(maxBuyPrice, buyPrice);

        if (remaining <= 0) continue;
        const take = Math.min(remaining, batchStock);
        if (take <= 0) continue;
        await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = stock - $1 WHERE id = $2`, take, batch.id);
        batchDeductions.push({ itemCostId: batch.id, qty: take });
        remaining -= take;
      }
      if (remaining > 0) {
        throw new BadRequestException(`Stok ${row.name} tidak cukup`);
      }

      // Mirror spareparts.stock ikut kepotong — row udah kekunci FOR UPDATE
      // di query pertama method ini, aman dari race.
      await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = stock - $1 WHERE id = $2`, qty, refId);

      return {
        name: row.name,
        unit: row.unit,
        unitPrice: Number(row.sell_price),
        buyPrice: maxBuyPrice,
        batchDeductions,
      };
    }

    // kind === 'product' — FIFO lintas batch item_costs (gak berubah dari
    // Siklus harga-seragam 2026-09-22, cuma nambah Number() eksplisit di
    // stock batch karena kolomnya sekarang Decimal, lihat gotcha di atas).
    const productRows = await tx.$queryRawUnsafe<
      { name: string; active: boolean; sell_price: unknown }[]
    >(`SELECT name, active, sell_price FROM products WHERE id = $1`, refId);
    const product = productRows[0];
    if (!product) throw new BadRequestException(`Produk ${refId} tidak ditemukan`);
    if (!product.active) throw new BadRequestException(`${product.name} tidak aktif`);

    const batches = await tx.$queryRawUnsafe<{ id: string; stock: unknown; buy_price: unknown }[]>(
      `SELECT id, stock, buy_price FROM item_costs
       WHERE kind = 'product' AND ref_id = $1 AND stock > 0
       ORDER BY created_at ASC FOR UPDATE`,
      refId,
    );

    let remaining = qty;
    let maxBuyPrice: number | null = null;
    const batchDeductions: { itemCostId: string; qty: number }[] = [];
    for (const batch of batches) {
      const batchStock = Number(batch.stock);
      // MAX(buyPrice) dihitung dari SEMUA batch berstok, gak peduli kepotong
      // FIFO atau enggak — skenario "harga modal TERMAHAL" buat warning
      // below-cost (keputusan user 2026-09-22), bukan cuma batch yang narik.
      const buyPrice = Number(batch.buy_price);
      maxBuyPrice = maxBuyPrice === null ? buyPrice : Math.max(maxBuyPrice, buyPrice);

      if (remaining <= 0) continue;
      const take = Math.min(remaining, batchStock);
      if (take <= 0) continue;
      await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = stock - $1 WHERE id = $2`, take, batch.id);
      batchDeductions.push({ itemCostId: batch.id, qty: take });
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BadRequestException(`Stok ${product.name} tidak cukup`);
    }

    return {
      name: product.name,
      unit: 'unit',
      unitPrice: Number(product.sell_price),
      buyPrice: maxBuyPrice,
      batchDeductions,
    };
  }

  /**
   * Kunci 1 baris `spareparts`, tambah stok. Dipakai barang masuk & opname
   * SPAREPART FLAT (batchTracked=false) SAJA. Sparepart batchTracked=true
   * pakai jalur baru di StockService.stockIn (bikin N baris item_costs,
   * bukan lewat sini) — lihat Task 6. TIDAK cek `active`. Barang masuk
   * produk selalu bikin baris `item_costs` (batch) baru lewat
   * `StockService.stockIn()` langsung (`tx.itemCost.create`), gak lewat sini.
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

- [ ] **Step 4: Jalankan test, pastikan LULUS SEMUA (kind=product lama + kind=sparepart baru)**

Run: `npx jest stock-locking.service.spec.ts`
Expected: PASS — semua test di kedua `describe` block (product lama, sparepart baru) hijau.

- [ ] **Step 5: Commit**

```bash
git add src/common/services/stock-locking.service.ts src/common/services/stock-locking.service.spec.ts
git commit -m "feat(stock): lockAndDeduct sparepart batch-tracked (FIFO), fix bug unit hardcode 'pcs'"
```

---

### Task 3: `pos-calc.util.ts` — helper `allocateBatchDeductions`

**Files:**
- Modify: `src/pos/pos-calc.util.ts`
- Test: `src/pos/pos-calc.util.spec.ts`

- [ ] **Step 1: Tulis test buat `allocateBatchDeductions`**

Tambahkan di `pos-calc.util.spec.ts` (append, jangan hapus test `computeTotals`/`formatInvoiceNumber` yang udah ada):

```typescript
import { allocateBatchDeductions } from './pos-calc.util';

describe('allocateBatchDeductions', () => {
  it('1 consumer, 1 batch — alokasi langsung', () => {
    const result = allocateBatchDeductions(
      [{ qty: 5, meta: 'cart-item' }],
      [{ itemCostId: 'batch-a', qty: 5 }],
    );
    expect(result).toEqual([{ meta: 'cart-item', itemCostId: 'batch-a', qty: 5 }]);
  });

  it('1 consumer narik dari lebih dari 1 batch (FIFO)', () => {
    const result = allocateBatchDeductions(
      [{ qty: 6, meta: 'cart-item' }],
      [
        { itemCostId: 'roll-lama', qty: 4 },
        { itemCostId: 'roll-baru', qty: 2 },
      ],
    );
    expect(result).toEqual([
      { meta: 'cart-item', itemCostId: 'roll-lama', qty: 4 },
      { meta: 'cart-item', itemCostId: 'roll-baru', qty: 2 },
    ]);
  });

  it('2 consumer (cart item + paket instalasi) berbagi 1 batch yang sama', () => {
    const result = allocateBatchDeductions(
      [
        { qty: 3, meta: 'cart-item' },
        { qty: 2, meta: 'paket-1' },
      ],
      [{ itemCostId: 'roll-a', qty: 5 }],
    );
    expect(result).toEqual([
      { meta: 'cart-item', itemCostId: 'roll-a', qty: 3 },
      { meta: 'paket-1', itemCostId: 'roll-a', qty: 2 },
    ]);
  });

  it('2 consumer, kebutuhan nembus batas antar batch', () => {
    const result = allocateBatchDeductions(
      [
        { qty: 3, meta: 'cart-item' },
        { qty: 4, meta: 'paket-1' },
      ],
      [
        { itemCostId: 'roll-lama', qty: 4 },
        { itemCostId: 'roll-baru', qty: 3 },
      ],
    );
    expect(result).toEqual([
      { meta: 'cart-item', itemCostId: 'roll-lama', qty: 3 },
      { meta: 'paket-1', itemCostId: 'roll-lama', qty: 1 },
      { meta: 'paket-1', itemCostId: 'roll-baru', qty: 3 },
    ]);
  });

  it('lempar Error kalau total qty consumer melebihi total qty deductions (bug pemanggil)', () => {
    expect(() =>
      allocateBatchDeductions(
        [{ qty: 10, meta: 'cart-item' }],
        [{ itemCostId: 'roll-a', qty: 5 }],
      ),
    ).toThrow('allocateBatchDeductions');
  });

  it('array consumer kosong -> hasil kosong, gak manggil batch sama sekali', () => {
    expect(allocateBatchDeductions([], [{ itemCostId: 'roll-a', qty: 5 }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL** (`allocateBatchDeductions` belum ada)

Run: `npx jest pos-calc.util.spec.ts`
Expected: FAIL — `allocateBatchDeductions is not a function` atau import error.

- [ ] **Step 3: Implementasi**

Tambahkan di akhir `pos-calc.util.ts` (append setelah `formatInvoiceNumber`, jangan ubah 2 fungsi yang udah ada):

```typescript

export interface BatchDeduction {
  itemCostId: string;
  qty: number;
}

/**
 * Siklus sparepart-per-gulungan (2026-09-23) — dipakai PosService.checkout.
 * Kasusnya: 1 sparepart batchTracked bisa dipakai di DUA tempat sekaligus
 * dalam 1 checkout (baris cart biasa DAN paket instalasi) — keduanya digabung
 * jadi SATU kebutuhan qty lalu di-FIFO SEKALI lewat
 * StockLockingService.lockAndDeduct (biar lock & alokasi batch konsisten).
 * Fungsi ini misahin balik hasil FIFO gabungan itu (`deductions`, urut
 * TERTUA dulu, sama urutan batch dikunci) ke tiap consumer aslinya (`consumers`,
 * urutan sesuai urutan consumer butuh dilayani — cart item duluan, baru paket)
 * — biar StockMovement per-baris tetap presisi nunjuk batch/roll mana yang
 * kepotong, bukan cuma 1 baris gabungan yang nunjuk batch pertama doang.
 *
 * PRASYARAT: SUM(consumers[].qty) === SUM(deductions[].qty) — keduanya
 * berasal dari qty yang SAMA (qty gabungan yang dikirim ke lockAndDeduct).
 * Kalau gak match, itu bug pemanggil (bukan kondisi user-facing), makanya
 * lempar Error biasa (bukan BadRequestException) — harusnya ketauan pas
 * development/test, bukan kejadian di produksi.
 */
export function allocateBatchDeductions<T>(
  consumers: { qty: number; meta: T }[],
  deductions: BatchDeduction[],
): { meta: T; itemCostId: string; qty: number }[] {
  const result: { meta: T; itemCostId: string; qty: number }[] = [];
  let batchIdx = 0;
  let batchRemaining = deductions[0]?.qty ?? 0;

  for (const consumer of consumers) {
    let need = consumer.qty;
    while (need > 0) {
      if (batchRemaining <= 0) {
        batchIdx += 1;
        if (batchIdx >= deductions.length) {
          throw new Error(
            'allocateBatchDeductions: total qty consumer melebihi total qty deductions — qty gabungan gak sinkron (bug pemanggil)',
          );
        }
        batchRemaining = deductions[batchIdx].qty;
      }
      const take = Math.min(need, batchRemaining);
      result.push({ meta: consumer.meta, itemCostId: deductions[batchIdx].itemCostId, qty: take });
      need -= take;
      batchRemaining -= take;
    }
  }
  return result;
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS SEMUA**

Run: `npx jest pos-calc.util.spec.ts`
Expected: PASS — semua test `allocateBatchDeductions` + `computeTotals`/`formatInvoiceNumber` lama tetap hijau.

- [ ] **Step 5: Commit**

```bash
git add src/pos/pos-calc.util.ts src/pos/pos-calc.util.spec.ts
git commit -m "feat(pos): helper allocateBatchDeductions buat misahin FIFO gabungan per consumer"
```

---

### Task 4: `pos.service.ts` — pakai `allocateBatchDeductions`, fix `buyPriceSnapshot` sparepart batch-tracked

**Files:**
- Modify: `src/pos/pos.service.ts`

- [ ] **Step 1: Import helper baru**

Modify baris 11 (`import { computeTotals, formatInvoiceNumber } from './pos-calc.util';`) jadi:

```typescript
import { computeTotals, formatInvoiceNumber, allocateBatchDeductions } from './pos-calc.util';
```

- [ ] **Step 2: Fix `buyPriceSnapshot` sparepart — pakai `locked.buyPrice` kalau batch-tracked, fallback `itemCost.findFirst` kalau flat**

Cari blok ini (sekitar baris 158-162):

```typescript
          } else {
            const locked = stockResults.get(lineKey(item))!;
            const cost = await tx.itemCost.findFirst({ where: { kind: 'sparepart', refId: item.refId } });
            priced.set(lineKey(item), { ...locked, buyPriceSnapshot: cost ? Number(cost.buyPrice) : null });
          }
```

Ganti jadi:

```typescript
          } else {
            // kind === 'sparepart'. Siklus sparepart-per-gulungan
            // (2026-09-23): kalau batchTracked, `locked.batchDeductions`
            // udah keisi (StockLockingService FIFO lintas item_costs) dan
            // `locked.buyPrice` udah MAX dari batch berstok — itemCost.
            // findFirst() DI BAWAH cuma valid buat sparepart FLAT (yang
            // emang cuma punya 1 baris item_costs, invarian lama). Kalau
            // dipaksa dipakai buat batch-tracked, hasilnya sembarang baris
            // (findFirst gak ada ORDER BY eksplisit) — bukan cost yang
            // representatif.
            const locked = stockResults.get(lineKey(item))!;
            let buyPriceSnapshot: number | null;
            if (locked.batchDeductions) {
              buyPriceSnapshot = locked.buyPrice;
            } else {
              const cost = await tx.itemCost.findFirst({ where: { kind: 'sparepart', refId: item.refId } });
              buyPriceSnapshot = cost ? Number(cost.buyPrice) : null;
            }
            priced.set(lineKey(item), { ...locked, buyPriceSnapshot });
          }
```

- [ ] **Step 3: Bangun peta consumer per key SEBELUM 2 loop stock movement (item loop & packageLines loop)**

Cari baris tepat SEBELUM `const transaction = await tx.transaction.create({` (sekitar baris 255-257, tepat setelah blok `if (belowCostWarnings.length > 0 && !dto.confirmOverride) { ... }`). Sisipkan blok baru PERSIS SEBELUM `const transaction = ...`:

```typescript
        // Siklus sparepart-per-gulungan (2026-09-23) — buat key yang
        // batchDeductions-nya keisi (produk SELALU, sparepart CUMA kalau
        // batchTracked), pecah alokasi FIFO gabungan balik ke tiap consumer
        // (baris cart item + baris paket instalasi yang sama-sama narik
        // sparepart/produk itu) — biar StockMovement per-baris tetap nunjuk
        // batch/roll yang presisi. Urutan consumer per key: baris cart dulu
        // (kalau ada), baru baris paket (urutan dto.installations) — SAMA
        // urutan yang dipakai 2 loop di bawah, jadi split di sini konsisten
        // sama urutan movement yang bakal dibuat.
        type MovementConsumer =
          | { source: 'item'; item: (typeof dto.items)[number] }
          | { source: 'package'; line: PackageChargeLine };
        const batchSplitsByKey = new Map<
          string,
          { meta: MovementConsumer; itemCostId: string; qty: number }[]
        >();
        {
          const consumersByKey = new Map<string, { qty: number; meta: MovementConsumer }[]>();
          for (const item of dto.items) {
            if (item.kind === 'service') continue;
            const key = lineKey(item);
            const arr = consumersByKey.get(key) ?? [];
            arr.push({ qty: item.qty, meta: { source: 'item', item } });
            consumersByKey.set(key, arr);
          }
          for (const line of packageLines) {
            if (!line.sparepartId) continue;
            const key = `sparepart:${line.sparepartId}`;
            const arr = consumersByKey.get(key) ?? [];
            arr.push({ qty: line.qty, meta: { source: 'package', line } });
            consumersByKey.set(key, arr);
          }
          for (const [key, consumers] of consumersByKey) {
            const deductions = stockResults.get(key)?.batchDeductions;
            if (!deductions) continue; // produk selalu ada, sparepart cuma kalau batchTracked
            batchSplitsByKey.set(key, allocateBatchDeductions(consumers, deductions));
          }
        }

```

- [ ] **Step 4: Ganti loop item cart (sekarang beda perlakuan produk/sparepart) jadi 1 alur seragam pakai `batchSplitsByKey`**

Cari blok ini (sekitar baris 290-321):

```typescript
          if (item.kind === 'product') {
            // FIFO bisa narik dari LEBIH DARI 1 batch sekaligus — 1
            // StockMovement PER batch yang beneran kepotong, biar histori
            // mutasi tetap presisi per-batch (dipakai laporan stok/opname).
            const locked = stockResults.get(lineKey(item))!;
            for (const d of locked.batchDeductions ?? []) {
              await tx.stockMovement.create({
                data: {
                  itemKind: 'product',
                  refId: item.refId,
                  name: p.name,
                  qtyChange: -d.qty,
                  reason: 'penjualan',
                  transactionId: transaction.id,
                  createdById: actorId,
                  itemCostId: d.itemCostId,
                },
              });
            }
          } else if (item.kind !== 'service') {
            await tx.stockMovement.create({
              data: {
                itemKind: item.kind,
                refId: item.refId,
                name: p.name,
                qtyChange: -item.qty,
                reason: 'penjualan',
                transactionId: transaction.id,
                createdById: actorId,
              },
            });
          }
```

Ganti jadi:

```typescript
          if (item.kind !== 'service') {
            // Siklus sparepart-per-gulungan (2026-09-23): produk SELALU
            // FIFO (batchSplitsByKey selalu keisi), sparepart cuma keisi
            // kalau batchTracked=true — sparepart flat jatuh ke cabang
            // `else` (1 StockMovement gabungan, TANPA itemCostId, perilaku
            // lama gak berubah).
            //
            // Filter `meta.source==='item' && meta.item===item` WAJIB —
            // batchSplitsByKey per key bisa berisi GABUNGAN split milik
            // consumer 'item' INI dan consumer 'package' (paket instalasi
            // yang kebetulan pakai sparepart yang sama, lihat Step 3). Tanpa
            // filter ini, splits milik paket bakal ikut ke-loop DI SINI
            // JUGA (dobel-hitung) — bagiannya cuma boleh dieksekusi sekali,
            // di loop paket (Step 5).
            const splits = batchSplitsByKey
              .get(lineKey(item))
              ?.filter((s) => s.meta.source === 'item' && s.meta.item === item);
            if (splits && splits.length > 0) {
              for (const s of splits) {
                await tx.stockMovement.create({
                  data: {
                    itemKind: item.kind,
                    refId: item.refId,
                    name: p.name,
                    qtyChange: -s.qty,
                    reason: 'penjualan',
                    transactionId: transaction.id,
                    createdById: actorId,
                    itemCostId: s.itemCostId,
                  },
                });
              }
            } else {
              await tx.stockMovement.create({
                data: {
                  itemKind: item.kind,
                  refId: item.refId,
                  name: p.name,
                  qtyChange: -item.qty,
                  reason: 'penjualan',
                  transactionId: transaction.id,
                  createdById: actorId,
                },
              });
            }
          }
```

- [ ] **Step 5: Ganti stock movement paket instalasi (sekarang selalu 1 baris gabungan) biar ikut batch-aware**

Cari blok ini (sekitar baris 338-350):

```typescript
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
```

Ganti jadi:

```typescript
          if (line.sparepartId) {
            const key = `sparepart:${line.sparepartId}`;
            const splits = batchSplitsByKey.get(key)?.filter(
              (s) => s.meta.source === 'package' && s.meta.line === line,
            );
            if (splits && splits.length > 0) {
              for (const s of splits) {
                await tx.stockMovement.create({
                  data: {
                    itemKind: 'sparepart',
                    refId: line.sparepartId,
                    name: line.name,
                    qtyChange: -s.qty,
                    reason: 'pemakaian_instalasi',
                    transactionId: transaction.id,
                    createdById: actorId,
                    itemCostId: s.itemCostId,
                  },
                });
              }
            } else {
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
```

- [ ] **Step 6: Trace manual (gak ada `npx jest` end-to-end di sandbox — lihat catatan adaptasi)**

Telusuri 2 skenario dengan tangan, baca literal kode Step 3-5:
1. **1 sparepart batchTracked di cart AJA (gak ada paket)** — `consumersByKey` buat key itu cuma punya 1 entry `{source:'item', item}`. `allocateBatchDeductions` misahin `deductions` (dari `lockAndDeduct`) balik ke 1 consumer itu — semua split punya `meta.source==='item'` dan `meta.item===item`, jadi filter di Step 4 meloloskan SEMUANYA (hasilnya sama kayak sebelum ada helper: N StockMovement per batch). Filter di Step 5 (`meta.source==='package'`) gak match apa pun buat key ini (`splits` undefined/kosong) — packageLines loop jatuh ke cabang `else` SETIAP sparepartId yang gak ada di paket, TAPI kalau sparepartId itu emang gak dipakai paket sama sekali, `line.sparepartId` yang match key ini juga gak ada di `packageLines`, jadi cabang ini gak pernah keeksekusi buat key itu. Qty total match.
2. **1 sparepart batchTracked dipakai di cart QTY 3 DAN paket instalasi QTY 2 (refId sama)** — `demand` map (kode existing, gak disentuh task ini) udah gabung jadi qty=5 sebelum `lockAndDeduct` dipanggil sekali. `consumersByKey` buat key itu punya 2 entry (`item` qty 3, `package` qty 2) urutan sama persis. `allocateBatchDeductions` misahin 5 unit deduction ke 2 consumer itu SESUAI urutan (item duluan, abis itu package). Loop item cart (Step 4) filter `meta.source==='item' && meta.item===item` — CUMA dapet split milik consumer 'item' (qty 3 total, bisa 1-2 baris StockMovement tergantung batas antar-batch). Loop paket (Step 5) filter `meta.source==='package' && meta.line===line` — CUMA dapet split milik consumer 'package' utk `line` itu spesifik (qty 2 total). Kedua filter itu SALING EKSKLUSIF (beda `source`), jadi gak ada split yang keeksekusi dobel ATAU kelewat. Total StockMovement qty buat sparepart itu across both loops = 3 + 2 = 5, match `demand` & match total `deductions` dari `lockAndDeduct`.
3. **Produk (bukan sparepart)** — gak pernah masuk `packageLines` (cuma sparepart yang bisa jadi item paket, lihat `PackageChargeLine.sparepartId`), jadi `consumersByKey` produk SELALU cuma 1 entry (`source:'item'`) — filter Step 4 meloloskan semua split-nya, perilaku identik sebelum Task 4 (regression aman).

- [ ] **Step 7: Commit**

```bash
git add src/pos/pos.service.ts
git commit -m "feat(pos): checkout sparepart batch-tracked - StockMovement per-batch presisi (cart+paket)"
```

---

### Task 5: `stock-in.dto.ts` — field `rolls`, `qty` jadi kondisional

**Files:**
- Modify: `src/stock/dto/stock-in.dto.ts` (rewrite penuh)

- [ ] **Step 1: Rewrite `stock-in.dto.ts`**

Ganti ISI FILE PENUH jadi:

```typescript
import {
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsQtyValidForKind } from './qty-by-kind.validator';

export class StockInRollDto {
  // Panjang 1 gulungan (meter, atau satuan sparepart itu). Boleh pecahan
  // (maks 2 desimal, sama presisi DECIMAL(10,2) kolom item_costs.stock).
  @IsNumber()
  @Min(0.01)
  length: number;
}

export class StockInDto {
  @IsIn(['product', 'sparepart'])
  kind: 'product' | 'sparepart';

  @IsString()
  @IsNotEmpty()
  refId: string;

  // Siklus sparepart-per-gulungan (2026-09-23) — `qty` sekarang OPSIONAL di
  // level DTO. Wajib-tidaknya tergantung KOMBINASI kind + (buat sparepart)
  // Sparepart.batchTracked, yang cuma bisa dicek dengan query DB — gak bisa
  // divalidasi class-validator murni (beda dari @ValidateIf yang cuma bisa
  // liat field SEKELAS, gak bisa nyambung ke DB). Makanya requiredness-nya
  // dicek MANUAL di StockService.stockIn:
  //   - kind='product'            -> qty WAJIB (dicek service, BadRequestException kalau kosong)
  //   - kind='sparepart', flat    -> qty WAJIB, `rolls` HARUS kosong
  //   - kind='sparepart', batchTracked -> `rolls` WAJIB (min 1), qty diabaikan
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @IsQtyValidForKind('kind')
  qty?: number;

  // BARU — cuma dipakai kind='sparepart' DENGAN Sparepart.batchTracked=true.
  // Tiap elemen = 1 gulungan baru yang masuk hari ini, panjangnya BOLEH
  // beda-beda per gulungan (gak ada default tersimpan) — SATU buyPrice di
  // bawah berlaku buat SEMUA gulungan dalam 1 barang-masuk ini (admin input
  // 1 nota, harga modal biasanya sama per nota).
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StockInRollDto)
  @ArrayMinSize(1)
  rolls?: StockInRollDto[];

  @IsNumber()
  @Min(0)
  buyPrice: number;

  // Siklus harga-seragam (2026-09-22) — sellPrice DIHAPUS dari sini. Harga
  // jual produk sekarang SATU angka seragam di Product.sellPrice, diatur
  // lewat Master Data Produk (create/update), BUKAN per-batch pas barang
  // masuk lagi. Warning "jual di bawah modal" pas barang masuk (StockService
  // .stockIn) sekarang banding buyPrice batch baru INI ke Product.sellPrice
  // yang UDAH ADA.

  // Opsional, catatan asal barang — cuma dipakai kalau kind='product' atau
  // kind='sparepart' batchTracked (bikin batch baru, punya konsep supplier
  // per-kedatangan). Sparepart flat gak pakai field ini (perilaku lama).
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

- [ ] **Step 2: Trace manual — cek `IsQtyValidForKind` masih jalan bareng `@IsOptional()`**

`class-validator`: `@IsOptional()` bikin SEMUA validator lain di field yang sama di-skip kalau value-nya `undefined` (bukan `null`/`0`). Jadi kalau `dto.qty` gak dikirim sama sekali (kasus sparepart batchTracked yang kirim `rolls` doang), `@IsQtyValidForKind` gak dipanggil — aman, gak ada konflik. Kalau `qty` DIKIRIM (kasus product/sparepart-flat), semua validator jalan normal kayak sebelumnya.

- [ ] **Step 3: Commit**

```bash
git add src/stock/dto/stock-in.dto.ts
git commit -m "feat(stock): StockInDto - tambah rolls buat sparepart batch-tracked, qty jadi kondisional"
```

---

### Task 6: `stock.service.ts` — `stockIn` & `opname` dukung sparepart batch-tracked

**Files:**
- Modify: `src/stock/stock.service.ts` (rewrite penuh)

- [ ] **Step 1: Rewrite `stock.service.ts`**

Ganti ISI FILE PENUH jadi:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService } from '../common/services/stock-locking.service';
import { StockInDto } from './dto/stock-in.dto';
import { StockOpnameDto, OpnameItemDto } from './dto/stock-opname.dto';
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';
import { checkBelowCost } from '../common/below-cost.util';
import { ConfirmationRequiredException } from '../common/exceptions/confirmation-required.exception';

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    private stockLocking: StockLockingService,
  ) {}

  /** Barang masuk: sparepart FLAT tetap 1 harga (upsert, perilaku lama).
   * Sparepart BATCH-TRACKED (Siklus sparepart-per-gulungan 2026-09-23) bikin
   * N baris item_costs baru (1 per gulungan/`dto.rolls[]`) + StockMovement
   * per gulungan, sinkron mirror `spareparts.stock`. Produk selalu bikin
   * batch (ItemCost) baru + cek warning "jual di bawah modal". */
  async stockIn(dto: StockInDto, actorId: string) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (dto.kind === 'sparepart') {
          const sparepart = await tx.sparepart.findUnique({ where: { id: dto.refId } });
          if (!sparepart) throw new BadRequestException(`Sparepart ${dto.refId} tidak ditemukan`);

          if (sparepart.batchTracked) {
            if (!dto.rolls?.length) {
              throw new BadRequestException(
                `${sparepart.name} dilacak per-gulungan — isi jumlah & panjang tiap gulungan (rolls)`,
              );
            }
            // Lock baris sparepart DULU (buat mirror stock di bawah) —
            // pola sama kayak lockAndAdd, tapi manual di sini karena kita
            // butuh bikin BANYAK baris item_costs (bukan 1 upsert). SELECT
            // `stock` DI SINI (bukan cuma `SELECT id`) — baca previousStock
            // DI DALAM lock yang sama biar akurat di bawah concurrency, sama
            // pola kayak `lockAndAdd` (beda dari `tx.sparepart.findUnique`
            // di atas yang TANPA lock, cuma buat cek existence/batchTracked/
            // name — stock hasil baca itu BUKAN sumber previousStock lagi).
            const lockedRows = await tx.$queryRawUnsafe<{ stock: unknown }[]>(
              `SELECT stock FROM spareparts WHERE id = $1 FOR UPDATE`,
              dto.refId,
            );
            const previousStock = Number(lockedRows[0].stock);

            let totalQty = 0;
            const batchIds: string[] = [];
            const movementIds: string[] = [];
            for (const roll of dto.rolls) {
              const batch = await tx.itemCost.create({
                data: {
                  kind: 'sparepart',
                  refId: dto.refId,
                  supplierName: dto.supplierName,
                  buyPrice: dto.buyPrice,
                  sellPrice: 0, // placeholder, gak dipakai — sparepart harga jual tetap dari Sparepart.sellPrice
                  stock: roll.length,
                },
              });
              batchIds.push(batch.id);
              totalQty += roll.length;
              const movement = await tx.stockMovement.create({
                data: {
                  itemKind: 'sparepart',
                  refId: dto.refId,
                  name: sparepart.name,
                  qtyChange: roll.length,
                  reason: 'barang_masuk',
                  createdById: actorId,
                  itemCostId: batch.id,
                },
              });
              movementIds.push(movement.id);
            }

            await tx.$executeRawUnsafe(
              `UPDATE spareparts SET stock = stock + $1 WHERE id = $2`,
              totalQty,
              dto.refId,
            );

            await tx.auditLog.create({
              data: {
                actorUid: actorId,
                action: 'stock.in',
                target: dto.refId,
                detail: {
                  kind: dto.kind,
                  name: sparepart.name,
                  rolls: dto.rolls.map((r) => r.length),
                  totalQty,
                  buyPrice: dto.buyPrice,
                  batchIds,
                  movementIds,
                  note: dto.note ?? null,
                },
              },
            });

            return {
              kind: 'sparepart' as const,
              // movementId = StockMovement PERTAMA (1 per roll dibuat di
              // atas) — beda dari sebelumnya yang salah nunjuk `batchIds[0]`
              // (id item_costs, bukan id stock_movements). Konsumen yang
              // butuh SEMUA movement per roll pakai `movementIds` di
              // auditLog.detail di atas, bukan field balikan ini (field ini
              // cuma representatif satu, sama semantik kayak cabang flat
              // di bawah).
              movementId: movementIds[0],
              refId: dto.refId,
              name: sparepart.name,
              previousStock,
              newStock: previousStock + totalQty,
            };
          }

          // Flat (batchTracked=false) — perilaku lama, gak berubah.
          if (dto.qty === undefined) {
            throw new BadRequestException('Qty wajib diisi buat sparepart ini');
          }
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

          // Bukan tx.itemCost.upsert({where:{kind_refId:...}}) — PK item_costs
          // sekarang `id` sendiri (Siklus batch-cost 2026-09), `[kind,refId]`
          // cuma @@index biasa (BUKAN @@unique — sengaja, kind='product' HARUS
          // boleh banyak baris per refId buat batch). Prisma gak generate tipe
          // filter compound `kind_refId` dari index biasa, jadi upsert manual.
          //
          // findFirst+create manual TANPA lock itu rawan race (ketemu review
          // 2026-09-08): 2 stockIn sparepart yang sama BARENGAN bisa
          // dua-duanya lolos findFirst (belum ada baris), dua-duanya create
          // -> 2 baris item_costs buat 1 sparepart, ngelanggar invarian
          // "sparepart cuma 1 baris" yang dijaga di kode (bukan constraint DB).
          // Invarian ini SEKARANG cuma berlaku buat batchTracked=false — lihat
          // cabang batchTracked=true di atas yang SENGAJA bikin banyak baris.
          // pg_advisory_xact_lock kunci per (kind='sparepart', refId) SELAMA
          // transaksi ini — panggilan stockIn sparepart lain buat refId yang
          // sama otomatis NUNGGU sampai transaksi ini commit/rollback, baru
          // findFirst-nya baca data yang udah kebaruan. Lock ke-release
          // otomatis pas transaksi selesai (xact = scoped ke transaksi).
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtext('item_costs_sparepart'), hashtext($1))`,
            dto.refId,
          );
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

        // kind === 'product' — selalu bikin batch (item_costs) BARU. Siklus
        // harga-seragam (2026-09-22): sellPrice GAK lagi diinput di sini —
        // dibaca dari Product.sellPrice (satu-satunya sumber harga jual
        // produk). Batch baru nulis 0 ke item_costs.sell_price (placeholder,
        // gak dipakai — sama pola kayak kind='sparepart').
        if (dto.qty === undefined) {
          throw new BadRequestException('Qty wajib diisi');
        }
        const product = await tx.product.findUnique({ where: { id: dto.refId } });
        if (!product) throw new BadRequestException(`Produk ${dto.refId} tidak ditemukan`);

        const { isBelowCost, effectivePrice } = checkBelowCost({
          buyPrice: dto.buyPrice,
          sellPrice: Number(product.sellPrice),
        });
        if (isBelowCost && !dto.confirmOverride) {
          throw new ConfirmationRequiredException([
            {
              refId: dto.refId,
              itemCostId: null,
              name: product.name,
              buyPrice: dto.buyPrice,
              sellPrice: Number(product.sellPrice),
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
            sellPrice: 0,
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

  /** Stock opname: koreksi stok LANGSUNG ke angka fisik.
   * - Sparepart FLAT — per-produk (kayak dulu), gak berubah.
   * - Produk — PER-BATCH (item_costs), gak berubah dari Siklus batch-cost.
   * - Sparepart BATCH-TRACKED (BARU, Siklus sparepart-per-gulungan
   *   2026-09-23) — PER-BATCH juga (nunjuk `itemCostId` = roll mana),
   *   sinkron mirror `spareparts.stock` ikut kekoreksi selisihnya. */
  async opname(dto: StockOpnameDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // sort dulu (sparepart flat by refId, produk & sparepart batch-tracked
      // by itemCostId) — hindari deadlock kalau ada opname/checkout lain
      // jalan barengan.
      const sorted = [...dto.items].sort((a, b) => {
        const keyA = a.itemCostId ?? a.refId;
        const keyB = b.itemCostId ?? b.refId;
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
        if (item.kind === 'sparepart' && !item.itemCostId) {
          // Sparepart FLAT — TANPA itemCostId. Kalau ternyata sparepart-nya
          // batchTracked=true tapi request gak ngirim itemCostId, tolak DI
          // SINI (bukan diam-diam dianggap flat) — cek eksplisit di bawah.
          const rows = await tx.$queryRawUnsafe<{ name: string; stock: unknown; batch_tracked: boolean }[]>(
            `SELECT name, stock, batch_tracked FROM spareparts WHERE id = $1 FOR UPDATE`,
            item.refId,
          );
          const row = rows[0];
          if (!row) throw new BadRequestException(`Item ${item.refId} tidak ditemukan`);
          if (row.batch_tracked) {
            throw new BadRequestException(
              `${row.name} dilacak per-gulungan — opname wajib nunjuk itemCostId (roll mana yang dikoreksi)`,
            );
          }

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

        // kind === 'product', ATAU kind === 'sparepart' dengan itemCostId
        // (batch-tracked) — koreksi 1 BATCH/ROLL spesifik. Join tabel induk
        // beda tergantung kind (products vs spareparts) buat ambil `name`.
        if (!item.itemCostId) {
          throw new BadRequestException('itemCostId wajib diisi buat opname produk/sparepart per-batch');
        }

        // Sparepart batch-tracked: kunci baris `spareparts` (buat mirror di
        // bawah) SEBELUM kunci `item_costs` di bawah — urutan ini WAJIB SAMA
        // kayak StockLockingService.lockAndDeduct (spareparts dulu, baru
        // item_costs). Kalau kebalik (item_costs dulu baru spareparts),
        // opname yang jalan BARENGAN sama checkout/markUsed sparepart yang
        // sama bisa DEADLOCK (pola lock ABBA — checkout kunci
        // spareparts->item_costs, kalau opname kunci item_costs->spareparts,
        // dua-duanya bisa saling nunggu). Produk gak punya baris mirror,
        // jadi gak ada lock tambahan buat kind='product' di sini.
        if (item.kind === 'sparepart') {
          await tx.$executeRawUnsafe(`SELECT id FROM spareparts WHERE id = $1 FOR UPDATE`, item.refId);
        }

        const joinTable = item.kind === 'product' ? 'products' : 'spareparts';
        const rows = await tx.$queryRawUnsafe<{ name: string; stock: unknown }[]>(
          `SELECT parent.name AS name, ic.stock AS stock
           FROM item_costs ic
           JOIN ${joinTable} parent ON parent.id = ic.ref_id
           WHERE ic.id = $1 AND ic.kind = $2
           FOR UPDATE OF ic`,
          item.itemCostId,
          item.kind,
        );
        const row = rows[0];
        if (!row) throw new BadRequestException(`Batch ${item.itemCostId} tidak ditemukan`);

        // GOTCHA node-pg (Task 1): item_costs.stock sekarang NUMERIC, balik
        // string dari raw query — wajib Number() (beda dari waktu masih
        // INTEGER, auto-parse ke number).
        const systemQty = Number(row.stock);
        const delta = item.physicalQty - systemQty;

        if (delta === 0) {
          results.push({ refId: item.refId, itemCostId: item.itemCostId, name: row.name, systemQty, physicalQty: item.physicalQty, delta: 0 });
          continue;
        }

        await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = $1 WHERE id = $2`, item.physicalQty, item.itemCostId);

        // Mirror spareparts.stock ikut kekoreksi selisihnya — row udah
        // kekunci FOR UPDATE di atas (SEBELUM item_costs, lihat komentar lock
        // ordering di atas), aman dari race.
        if (item.kind === 'sparepart') {
          await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = stock + $1 WHERE id = $2`, delta, item.refId);
        }

        await tx.stockMovement.create({
          data: {
            itemKind: item.kind,
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
            detail: { kind: item.kind, itemCostId: item.itemCostId, name: row.name, systemQty, physicalQty: item.physicalQty, delta, note: dto.note ?? null },
          },
        });

        results.push({ refId: item.refId, itemCostId: item.itemCostId, name: row.name, systemQty, physicalQty: item.physicalQty, delta });
      }

      return results;
    });
  }

  /** Histori keluar-masuk stok — read-only, gabungan dari semua jalur (checkout, servis, barang masuk, opname). */
  async findMovements(query: StockMovementsQueryDto) {
    return this.prisma.stockMovement.findMany({
      where: {
        itemKind: query.itemKind,
        refId: query.refId,
        reason: query.reason,
        createdAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // guard sederhana, cukup buat skala 1 toko — belum perlu pagination formal
    });
  }
}
```

**Catatan penting soal `OpnameItemDto` (Task 7 di bawah)**: kode di atas makai `item.itemCostId` sebagai penentu cabang (`kind==='sparepart' && !itemCostId` = flat, selain itu = per-batch), BUKAN `item.kind` doang kayak sebelumnya. Ini konsisten sama keputusan di Task 7 yang bikin `OpnameItemDto.itemCostId` opsional TANPA `@ValidateIf` (karena "wajib apa nggak" tergantung `Sparepart.batchTracked`, gak bisa dicek DTO-level).

- [ ] **Step 2: Trace manual skenario baru (gak ada DB/jest di sandbox)**

1. Barang masuk sparepart batchTracked=true, `rolls=[{length:5},{length:7}]`, `buyPrice=18000` — bikin 2 baris item_costs (stock 5 & 7), 2 StockMovement (`qtyChange` +5 dan +7, masing2 `itemCostId` beda), `spareparts.stock` naik +12. ✅.
2. Barang masuk sparepart batchTracked=true TANPA `rolls` — `BadRequestException` sebelum nyentuh DB. ✅ (Step 1 cabang batchTracked).
3. Barang masuk sparepart flat (batchTracked=false) TANPA `qty` — `BadRequestException` "Qty wajib diisi buat sparepart ini". ✅.
4. Barang masuk produk TANPA `qty` — `BadRequestException` "Qty wajib diisi" SEBELUM query `product.findUnique` (hemat 1 round-trip DB kalau emang mau ditolak). ✅.
5. Opname sparepart flat, `itemCostId` gak dikirim — masuk cabang pertama (`kind==='sparepart' && !itemCostId`), cek `batch_tracked` dari DB — kalau ternyata `false`, jalan normal (perilaku lama). ✅.
6. Opname sparepart yang TERNYATA `batchTracked=true` tapi kasir/admin lupa kirim `itemCostId` — masuk cabang pertama juga (karena `!item.itemCostId`), tapi `row.batch_tracked` ketauan `true` dari query, langsung `BadRequestException` yang jelas ("opname wajib nunjuk itemCostId"). ✅ — ini skenario yang harus DITOLAK, bukan diam2 dianggap flat (would silently corrupt the mirror).
7. Opname sparepart batch-tracked, `itemCostId` dikirim — masuk cabang kedua (`item.itemCostId` truthy), `joinTable='spareparts'`, query gabung `item_costs JOIN spareparts`, dapet `row.name` & `row.stock` (batch itu). Update `item_costs.stock`, LALU (karena `item.kind==='sparepart'`) kunci+update mirror `spareparts.stock += delta`. StockMovement dibuat dengan `itemCostId`. ✅.
8. Opname produk (`itemCostId` dikirim, seperti biasa) — masuk cabang kedua, `joinTable='products'`, SAMA PERSIS query & alur lama (cuma ganti dari SQL literal `'product'` jadi parameter `$2` + `joinTable` variabel — hasil query identik buat kind='product'). Cabang `if (item.kind==='sparepart')` buat sync mirror di-skip (produk gak punya mirror). ✅ — regression aman.

- [ ] **Step 3: Commit**

```bash
git add src/stock/stock.service.ts
git commit -m "feat(stock): stockIn & opname dukung sparepart batch-tracked (N-roll, per-batch opname)"
```

---

### Task 7: `OpnameItemDto` — `itemCostId` jadi opsional (validasi pindah ke service)

**Files:**
- Modify: `src/stock/dto/stock-opname.dto.ts`

- [ ] **Step 1: Rewrite `stock-opname.dto.ts`**

Ganti ISI FILE PENUH jadi:

```typescript
import {
  ArrayMinSize,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
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

  // Siklus sparepart-per-gulungan (2026-09-23) — SEBELUMNYA `@ValidateIf(kind
  // ==='product')` bikin field ini wajib CUMA kalau kind='product'. Sekarang
  // opsional buat SEMUA kind di level DTO, karena wajib-tidaknya buat
  // kind='sparepart' tergantung Sparepart.batchTracked (state DB, gak bisa
  // dicek @ValidateIf yang cuma liat field sekelas). Business rule lengkapnya
  // (produk SELALU wajib; sparepart wajib CUMA kalau batchTracked=true; kalau
  // batchTracked=true tapi dikosongkan -> ditolak, bukan dianggap flat) ada
  // di StockService.opname — lihat komentar di sana.
  @IsOptional()
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

- [ ] **Step 2: Trace manual — pastikan produk TETAP efektif wajib `itemCostId`**

DTO-level, `itemCostId` sekarang opsional buat SEMUA kind (termasuk `product`). Tapi `StockService.opname` (Task 6) nolak eksplisit di cabang kedua: `if (!item.itemCostId) throw new BadRequestException(...)` SEBELUM proses per-batch — jadi produk tanpa `itemCostId` tetap ditolak, cuma pindah dari validasi DTO ke validasi service (pesan errornya beda tapi tetep 400).

- [ ] **Step 3: Commit**

```bash
git add src/stock/dto/stock-opname.dto.ts
git commit -m "feat(stock): OpnameItemDto.itemCostId opsional di DTO, validasi pindah ke service"
```

---

### Task 8: `SparepartsService` + DTO — `batchTracked`, endpoint batch history

**Files:**
- Modify: `src/spareparts/dto/create-sparepart.dto.ts`
- Modify: `src/spareparts/dto/update-sparepart.dto.ts`
- Modify: `src/spareparts/spareparts.service.ts`
- Modify: `src/spareparts/spareparts.controller.ts`

- [ ] **Step 1: `create-sparepart.dto.ts` — tambah `batchTracked`**

Ganti ISI FILE PENUH jadi:

```typescript
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSparepartDto {
  @IsString() name: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() category?: string;
  @IsString() unit: string;
  @IsNumber() @Min(0) sellPrice: number;
  @IsNumber() @Min(0) stock: number;
  @IsOptional() @IsNumber() @Min(0) minStock?: number;
  // Siklus sparepart-per-gulungan (2026-09-23) — opsional, default false
  // (di service, lihat SparepartsService.create). true = sparepart ini
  // dilacak per-gulungan/batch (FIFO kayak Produk) — biasanya buat barang
  // yang dijual per-meter dengan panjang beda-beda tiap kedatangan.
  @IsOptional() @IsBoolean() batchTracked?: boolean;
}
```

- [ ] **Step 2: `update-sparepart.dto.ts` — tambah `batchTracked`**

Ganti ISI FILE PENUH jadi:

```typescript
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Sama seperti CreateSparepartDto, semua opsional (PATCH parsial) — KECUALI
// `stock`. Alasan sama seperti UpdateProductDto: stok cuma boleh dimutasi
// lewat StockService (stockIn/opname) biar StockMovement-nya konsisten.
export class UpdateSparepartDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() @Min(0) sellPrice?: number;
  @IsOptional() @IsNumber() @Min(0) minStock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  // Siklus sparepart-per-gulungan (2026-09-23) — admin boleh toggle kapan
  // aja (bukan cuma pas create). Nge-toggle TIDAK migrasi data item_costs
  // yang udah ada — lihat catatan invarian di schema.prisma model Sparepart.
  @IsOptional() @IsBoolean() batchTracked?: boolean;
}
```

- [ ] **Step 3: `spareparts.service.ts` — default `batchTracked=false` di create, tambah `findBatches`**

Ganti ISI FILE PENUH jadi:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSparepartDto } from './dto/create-sparepart.dto';
import { UpdateSparepartDto } from './dto/update-sparepart.dto';

@Injectable()
export class SparepartsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSparepartDto) {
    return this.prisma.sparepart.create({
      data: { ...dto, batchTracked: dto.batchTracked ?? false, active: true },
    });
  }

  findAll() {
    return this.prisma.sparepart.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  }

  /** Dipakai autocomplete input sparepart teknisi (requirement eksplisit). */
  search(query: string) {
    return this.prisma.sparepart.findMany({
      where: { active: true, name: { contains: query, mode: 'insensitive' } },
      take: 10,
      orderBy: { name: 'asc' },
    });
  }

  /** List batch/gulungan AKTIF (stock>0) 1 sparepart batch-tracked — dipakai
   * halaman detail sparepart (tabel "gulungan aktif") & referensi harga pas
   * barang masuk lagi. Urut TERTUA dulu, konsisten sama urutan FIFO di
   * StockLockingService.lockAndDeduct. Sama pola persis kayak
   * ProductsService.findBatches — dipisah di sini (bukan di-share) karena
   * beda entity induk (Sparepart vs Product), walau query-nya mirip.
   *
   * Siklus sparepart-per-gulungan (2026-09-23). */
  async findBatches(sparepartId: string) {
    const sparepart = await this.prisma.sparepart.findUnique({ where: { id: sparepartId } });
    if (!sparepart) throw new NotFoundException('Sparepart tidak ditemukan');
    return this.prisma.itemCost.findMany({
      where: { kind: 'sparepart', refId: sparepartId, stock: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Edit sparepart setelah dibuat — sama alasannya kayak ProductsService.update. */
  async update(id: string, dto: UpdateSparepartDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.sparepart.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sparepart tidak ditemukan');

    const sparepart = await this.prisma.sparepart.update({ where: { id }, data: dto });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'sparepart.update',
        target: id,
        detail: { ...dto },
      },
    });

    return sparepart;
  }
}
```

- [ ] **Step 4: `spareparts.controller.ts` — tambah endpoint `GET /spareparts/:id/batches`**

Baca dulu isi file saat ini (`src/spareparts/spareparts.controller.ts`) buat nyamain gaya import/decorator persis (guard, roles, dst — sama pola kayak `ProductsController.findBatches` yang udah ada). Tambahkan method baru:

```typescript
  @Get(':id/batches')
  findBatches(@Param('id') id: string) {
    return this.sparepartsService.findBatches(id);
  }
```

Taruh persis di bawah method `search`/di atas `update` (urutan route sebelum route dinamis `:id` kalau ada konflik — cek urutan existing routes di file biar `:id/batches` gak ketiban route lain yang lebih general kayak `:id` polos, kalau ada). Tambahkan import `Get` dan `Param` dari `@nestjs/common` di baris import kalau belum ada.

- [ ] **Step 5: Commit**

```bash
git add src/spareparts/dto/create-sparepart.dto.ts src/spareparts/dto/update-sparepart.dto.ts src/spareparts/spareparts.service.ts src/spareparts/spareparts.controller.ts
git commit -m "feat(spareparts): tambah batchTracked + endpoint GET /spareparts/:id/batches"
```

---

### Task 9: `MaterialRequestsService.markUsed()` — `StockMovement` per-batch

**Files:**
- Modify: `src/material-requests/material-requests.service.ts`

- [ ] **Step 1: Ganti loop `markUsed()` biar pakai `batchDeductions`**

Cari blok ini (di method `markUsed`, sekitar baris 337-365):

```typescript
      for (const item of request.items) {
        // Siklus batch-cost (2026-09): kind='product' dicabut dari scope
        // pengajuan material — cuma 'sparepart' yang tersisa & tervalidasi
        // di priceItems(). Cek `=== 'sparepart'` di sini tetap dipertahankan
        // (bukan disederhanain jadi tanpa-if) sebagai pengaman kalau ada
        // baris lama/data legacy dengan kind lain nyangkut di DB.
        if (item.kind === 'sparepart') {
          await this.stockLocking.lockAndDeduct(
            tx,
            item.kind,
            // refId wajib diisi di CreateMaterialRequestDto (@IsNotEmpty) —
            // nullability di schema cuma pola generik ala invoice_items,
            // baris ini sendiri sama kayak stockMovement.create() di bawah
            // yang juga udah pakai `!` buat field yang sama.
            item.refId!,
            Number(item.qty),
          );
          await tx.stockMovement.create({
            data: {
              itemKind: item.kind,
              refId: item.refId!,
              name: item.name,
              qtyChange: new Prisma.Decimal(item.qty).neg(),
              reason: 'pemakaian_servis',
              createdById: actorId,
            },
          });
        }
      }
```

Ganti jadi:

```typescript
      for (const item of request.items) {
        // Siklus batch-cost (2026-09): kind='product' dicabut dari scope
        // pengajuan material — cuma 'sparepart' yang tersisa & tervalidasi
        // di priceItems(). Cek `=== 'sparepart'` di sini tetap dipertahankan
        // (bukan disederhanain jadi tanpa-if) sebagai pengaman kalau ada
        // baris lama/data legacy dengan kind lain nyangkut di DB.
        if (item.kind === 'sparepart') {
          const locked = await this.stockLocking.lockAndDeduct(
            tx,
            item.kind,
            // refId wajib diisi di CreateMaterialRequestDto (@IsNotEmpty) —
            // nullability di schema cuma pola generik ala invoice_items,
            // baris ini sendiri sama kayak stockMovement.create() di bawah
            // yang juga udah pakai `!` buat field yang sama.
            item.refId!,
            Number(item.qty),
          );

          // Siklus sparepart-per-gulungan (2026-09-23) — kalau sparepart-nya
          // batchTracked, `locked.batchDeductions` keisi (FIFO lintas
          // item_costs) dan tiap request cuma nyumbang 1 "consumer" ke
          // lockAndDeduct (beda dari PosService.checkout yang bisa gabungan
          // cart+paket) — jadi gak butuh allocateBatchDeductions, langsung
          // loop aja, 1 StockMovement per batch/roll yang kepotong. Sparepart
          // flat (batchDeductions undefined) tetap 1 StockMovement gabungan,
          // perilaku lama gak berubah.
          if (locked.batchDeductions) {
            for (const d of locked.batchDeductions) {
              await tx.stockMovement.create({
                data: {
                  itemKind: item.kind,
                  refId: item.refId!,
                  name: item.name,
                  qtyChange: new Prisma.Decimal(d.qty).neg(),
                  reason: 'pemakaian_servis',
                  createdById: actorId,
                  itemCostId: d.itemCostId,
                },
              });
            }
          } else {
            await tx.stockMovement.create({
              data: {
                itemKind: item.kind,
                refId: item.refId!,
                name: item.name,
                qtyChange: new Prisma.Decimal(item.qty).neg(),
                reason: 'pemakaian_servis',
                createdById: actorId,
              },
            });
          }
        }
      }
```

- [ ] **Step 2: Trace manual**

`Prisma` sudah diimpor di file ini (baris 7: `import { InvoiceStatus, Prisma, TechnicianJobStatus } from '@prisma/client';`) — gak perlu import baru. `locked.batchDeductions` cuma keisi kalau `lockAndDeduct` masuk cabang batch-tracked (Task 2) — sparepart flat balik `LockedItem` tanpa field itu (`undefined`), jatuh ke `else` (perilaku lama persis).

- [ ] **Step 3: Commit**

```bash
git add src/material-requests/material-requests.service.ts
git commit -m "feat(material-requests): markUsed - StockMovement per-batch buat sparepart batch-tracked"
```

---

### Task 10: Frontend — `master/sparepart/page.tsx` — toggle `batchTracked`

**Files:**
- Modify: `epos-frontend-web/src/app/(dashboard)/master/sparepart/page.tsx`

- [ ] **Step 1: Update interface `Sparepart` — tambah `batchTracked`**

Cari (baris 47-57):

```typescript
interface Sparepart {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  sellPrice: string;
  stock: string;
  minStock: string;
  active: boolean;
}
```

Ganti jadi:

```typescript
interface Sparepart {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  sellPrice: string;
  stock: string;
  minStock: string;
  active: boolean;
  // Siklus sparepart-per-gulungan (2026-09-23).
  batchTracked: boolean;
}
```

- [ ] **Step 2: Tambah `batchTracked` ke schema form + default values**

Cari (baris 59-68):

```typescript
const sparepartSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  sku: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().min(1, 'Wajib diisi (mis. pcs, kg, meter)'),
  sellPrice: requiredNumberField('Harga jual wajib diisi'),
  stock: requiredNumberField('Stok wajib diisi'),
  minStock: optionalNumberField,
  active: z.boolean(),
});
```

Ganti jadi:

```typescript
const sparepartSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  sku: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().min(1, 'Wajib diisi (mis. pcs, kg, meter)'),
  sellPrice: requiredNumberField('Harga jual wajib diisi'),
  stock: requiredNumberField('Stok wajib diisi'),
  minStock: optionalNumberField,
  active: z.boolean(),
  batchTracked: z.boolean(),
});
```

Cari (baris 71-80):

```typescript
const emptyValues: SparepartFormValues = {
  name: '',
  sku: '',
  category: '',
  unit: '',
  sellPrice: '',
  stock: '',
  minStock: '',
  active: true,
};
```

Ganti jadi:

```typescript
const emptyValues: SparepartFormValues = {
  name: '',
  sku: '',
  category: '',
  unit: '',
  sellPrice: '',
  stock: '',
  minStock: '',
  active: true,
  batchTracked: false,
};
```

Cari (baris 82-93):

```typescript
function toFormValues(s: Sparepart): SparepartFormValues {
  return {
    name: s.name,
    sku: s.sku ?? '',
    category: s.category ?? '',
    unit: s.unit,
    sellPrice: s.sellPrice,
    stock: s.stock,
    minStock: s.minStock,
    active: s.active,
  };
}
```

Ganti jadi:

```typescript
function toFormValues(s: Sparepart): SparepartFormValues {
  return {
    name: s.name,
    sku: s.sku ?? '',
    category: s.category ?? '',
    unit: s.unit,
    sellPrice: s.sellPrice,
    stock: s.stock,
    minStock: s.minStock,
    active: s.active,
    batchTracked: s.batchTracked,
  };
}
```

- [ ] **Step 3: Kirim `batchTracked` di mutation create & update**

Cari (baris 123-145):

```typescript
  const saveMutation = useMutation({
    mutationFn: async (values: SparepartFormValues) => {
      const base = {
        name: values.name.trim(),
        sku: trimmedOrUndefined(values.sku),
        category: trimmedOrUndefined(values.category),
        unit: values.unit.trim(),
        sellPrice: Number(values.sellPrice),
        minStock: values.minStock?.trim() ? Number(values.minStock) : undefined,
      };
      if (editing) {
        // Stok gak dikirim di update — cuma lewat halaman detail (klik baris
        // di tabel) biar StockMovement-nya konsisten.
        return apiClient.patch<Sparepart>(`/spareparts/${editing.id}`, {
          ...base,
          active: values.active,
        });
      }
      return apiClient.post<Sparepart>('/spareparts', {
        ...base,
        stock: Number(values.stock),
      });
    },
```

Ganti jadi:

```typescript
  const saveMutation = useMutation({
    mutationFn: async (values: SparepartFormValues) => {
      const base = {
        name: values.name.trim(),
        sku: trimmedOrUndefined(values.sku),
        category: trimmedOrUndefined(values.category),
        unit: values.unit.trim(),
        sellPrice: Number(values.sellPrice),
        minStock: values.minStock?.trim() ? Number(values.minStock) : undefined,
        batchTracked: values.batchTracked,
      };
      if (editing) {
        // Stok gak dikirim di update — cuma lewat halaman detail (klik baris
        // di tabel) biar StockMovement-nya konsisten.
        return apiClient.patch<Sparepart>(`/spareparts/${editing.id}`, {
          ...base,
          active: values.active,
        });
      }
      return apiClient.post<Sparepart>('/spareparts', {
        ...base,
        stock: Number(values.stock),
      });
    },
```

- [ ] **Step 4: Badge "Per Gulungan" di tabel list + checkbox di dialog form**

Cari (baris 199, kolom Nama di tabel):

```typescript
                  <TableCell className="font-medium">{s.name}</TableCell>
```

Ganti jadi:

```typescript
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {s.name}
                      {s.batchTracked && (
                        <Badge variant="secondary" className="text-xs font-normal">
                          Per Gulungan
                        </Badge>
                      )}
                    </div>
                  </TableCell>
```

Cari blok field `unit` di dialog form (baris 291-303):

```typescript
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Satuan</FormLabel>
                    <FormControl>
                      <Input placeholder="pcs, kg, meter, set" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
```

Tambahkan PERSIS setelah blok itu (sebelum `<div className="grid grid-cols-2 gap-4">` yang berisi `sellPrice`/`minStock`):

```typescript
              <FormField
                control={form.control}
                name="batchTracked"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div>
                      <FormLabel className="font-normal">Lacak per gulungan/batch</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Buat barang meteran (pipa, kabel) yang panjangnya beda-beda tiap kedatangan.
                        Bisa diubah lagi nanti.
                      </p>
                    </div>
                  </FormItem>
                )}
              />
```

- [ ] **Step 5: Trace manual**

`Checkbox` udah diimpor (baris 19, dipakai field `active`). `Badge` udah diimpor (baris 16, dipakai status Aktif/Nonaktif). Gak ada import baru dibutuhin.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/master/sparepart/page.tsx"
git commit -m "feat(fe): Master Data Sparepart - toggle batchTracked + badge Per Gulungan"
```

---

### Task 11: Frontend — `sparepart-detail-client.tsx` — form barang-masuk dinamis + tabel gulungan aktif

**Files:**
- Modify: `epos-frontend-web/src/app/(dashboard)/master/sparepart/[id]/sparepart-detail-client.tsx` (rewrite penuh)

- [ ] **Step 1: Rewrite `sparepart-detail-client.tsx`**

Ganti ISI FILE PENUH jadi:

```typescript
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatRupiah, formatDate } from '@/lib/format';
import { requiredNumberField, trimmedOrUndefined } from '@/lib/form-number';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Halaman detail sparepart — pasangan product-detail-client.tsx, dibikin
// per keputusan 2026-09-15 (halaman penuh, bukan dialog popup). Beda sama
// Produk: gak ada endpoint GET /spareparts/:id di backend (SparepartsController
// cuma punya findAll/search/create/update), jadi datanya diambil dari list
// /spareparts terus dicari by id di sini — sama kayak pola lama yang dipakai
// dialog "Stok" sebelumnya.
//
// Siklus sparepart-per-gulungan (2026-09-23): kalau sparepart.batchTracked,
// form barang masuk BEDA — admin isi jumlah gulungan + panjang tiap gulungan
// (bisa beda-beda), SATU harga modal berlaku buat semua gulungan di 1 nota,
// dan ada tabel "Gulungan Aktif" (mirror pola tabel batch di
// product-detail-client.tsx / stock-client.tsx ProductStockInTab). Sparepart
// flat (batchTracked=false) TETAP form lama (qty tunggal), gak ada tabel
// batch, gak ada below-cost check (backend emang gak ngecek itu buat
// sparepart, batch-tracked ataupun flat).
interface Sparepart {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  sellPrice: string;
  stock: string;
  minStock: string;
  active: boolean;
  batchTracked: boolean;
}

interface SparepartBatch {
  id: string;
  supplierName: string | null;
  buyPrice: string;
  stock: string;
  createdAt: string;
}

interface StockInResult {
  status: 'ok' | 'confirm_required';
}

const flatStockInSchema = z.object({
  qty: requiredNumberField('Qty wajib diisi'),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  note: z.string().optional(),
});
type FlatStockInValues = z.infer<typeof flatStockInSchema>;
const flatStockInEmptyValues: FlatStockInValues = { qty: '', buyPrice: '', note: '' };

const rollStockInSchema = z.object({
  rolls: z
    .array(z.object({ length: requiredNumberField('Panjang wajib diisi') }))
    .min(1, 'Minimal 1 gulungan'),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  supplierName: z.string().optional(),
  note: z.string().optional(),
});
type RollStockInValues = z.infer<typeof rollStockInSchema>;
const rollStockInEmptyValues: RollStockInValues = {
  rolls: [{ length: '' }],
  buyPrice: '',
  supplierName: '',
  note: '',
};

export function SparepartDetailClient({ sparepartId }: { sparepartId: string }) {
  const sparepartsQuery = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });
  const sparepart = sparepartsQuery.data?.find((s) => s.id === sparepartId);

  if (sparepartsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat sparepart...</p>;
  }
  if (sparepartsQuery.isError) {
    return <p className="text-sm text-destructive">Gagal memuat data sparepart.</p>;
  }
  if (!sparepart) {
    return <p className="text-sm text-destructive">Sparepart tidak ditemukan.</p>;
  }

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/master/sparepart"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Kembali ke daftar sparepart
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{sparepart.name}</h1>
          <Badge variant={sparepart.active ? 'success' : 'secondary'}>
            {sparepart.active ? 'Aktif' : 'Nonaktif'}
          </Badge>
          {sparepart.batchTracked && <Badge variant="secondary">Per Gulungan</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Stok saat ini: {sparepart.stock} {sparepart.unit} • Harga jual:{' '}
          {formatRupiah(sparepart.sellPrice)}
        </p>
      </div>

      {sparepart.batchTracked ? (
        <BatchTrackedStockIn sparepart={sparepart} />
      ) : (
        <FlatStockIn sparepart={sparepart} />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sparepart FLAT — form lama, gak berubah.
// ----------------------------------------------------------------------------
function FlatStockIn({ sparepart }: { sparepart: Sparepart }) {
  const queryClient = useQueryClient();
  const stockInForm = useForm<FlatStockInValues>({
    resolver: zodResolver(flatStockInSchema),
    defaultValues: flatStockInEmptyValues,
  });

  const stockInMutation = useMutation({
    mutationFn: (values: FlatStockInValues) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'sparepart',
        refId: sparepart.id,
        qty: Number(values.qty),
        buyPrice: Number(values.buyPrice),
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: () => {
      toast.success('Barang masuk tersimpan.');
      stockInForm.reset(flatStockInEmptyValues);
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="text-base">Tambah Stok</CardTitle>
        <CardDescription>Catat kedatangan stok sparepart ini dari supplier.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...stockInForm}>
          <form
            onSubmit={stockInForm.handleSubmit((values) => stockInMutation.mutate(values))}
            className="grid gap-4"
          >
            <FormField
              control={stockInForm.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Qty Masuk ({sparepart.unit})</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={stockInForm.control}
              name="buyPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Harga Modal</FormLabel>
                  <FormControl>
                    <CurrencyInput {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={stockInForm.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Catatan</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Opsional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={stockInMutation.isPending}>
              {stockInMutation.isPending ? 'Menyimpan...' : 'Simpan Barang Masuk'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Sparepart BATCH-TRACKED (Siklus sparepart-per-gulungan 2026-09-23) — form
// jumlah gulungan + panjang per gulungan (dinamis, react-hook-form
// useFieldArray, pola sama kayak form multi-baris lain di app ini), SATU
// harga modal buat semua gulungan di 1 nota barang masuk. Tabel "Gulungan
// Aktif" di bawah mirip tabel batch produk (stock-client.tsx
// ProductStockInTab) — dari endpoint baru GET /spareparts/:id/batches.
// ----------------------------------------------------------------------------
function BatchTrackedStockIn({ sparepart }: { sparepart: Sparepart }) {
  const queryClient = useQueryClient();

  const batchesQuery = useQuery({
    queryKey: ['sparepart-batches', sparepart.id],
    queryFn: () => apiClient.get<SparepartBatch[]>(`/spareparts/${sparepart.id}/batches`),
  });

  const form = useForm<RollStockInValues>({
    resolver: zodResolver(rollStockInSchema),
    defaultValues: rollStockInEmptyValues,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'rolls' });

  const stockInMutation = useMutation({
    mutationFn: (values: RollStockInValues) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'sparepart',
        refId: sparepart.id,
        rolls: values.rolls.map((r) => ({ length: Number(r.length) })),
        buyPrice: Number(values.buyPrice),
        supplierName: trimmedOrUndefined(values.supplierName),
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: () => {
      toast.success('Barang masuk tersimpan.');
      form.reset(rollStockInEmptyValues);
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
      queryClient.invalidateQueries({ queryKey: ['sparepart-batches', sparepart.id] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gulungan Aktif</CardTitle>
          <CardDescription>Sisa panjang tiap gulungan yang masih berstok.</CardDescription>
        </CardHeader>
        <CardContent>
          {batchesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Memuat gulungan...</p>
          ) : !batchesQuery.data || batchesQuery.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada gulungan aktif — sparepart ini belum punya stok.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Modal</TableHead>
                    <TableHead>Sisa ({sparepart.unit})</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchesQuery.data.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-muted-foreground">{formatDate(b.createdAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{b.supplierName || '-'}</TableCell>
                      <TableCell>{formatRupiah(b.buyPrice)}</TableCell>
                      <TableCell>{b.stock}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tambah Gulungan Baru</CardTitle>
          <CardDescription>
            Isi panjang tiap gulungan yang datang — boleh beda-beda. Satu harga modal berlaku
            buat semua gulungan di nota ini.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => stockInMutation.mutate(values))}
              className="grid gap-4"
            >
              <div className="grid gap-2">
                <FormLabel>Gulungan ({sparepart.unit})</FormLabel>
                {fields.map((field, idx) => (
                  <div key={field.id} className="flex items-center gap-2">
                    <FormField
                      control={form.control}
                      name={`rolls.${idx}.length`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input inputMode="decimal" placeholder={`Panjang gulungan #${idx + 1}`} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={fields.length === 1}
                      onClick={() => remove(idx)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => append({ length: '' })}
                >
                  <Plus className="size-4" />
                  Tambah Gulungan
                </Button>
              </div>
              <FormField
                control={form.control}
                name="buyPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Harga Modal (per {sparepart.unit}, berlaku semua gulungan)</FormLabel>
                    <FormControl>
                      <CurrencyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="supplierName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier</FormLabel>
                    <FormControl>
                      <Input placeholder="Opsional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Catatan</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Opsional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={stockInMutation.isPending}>
                {stockInMutation.isPending ? 'Menyimpan...' : 'Simpan Barang Masuk'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Trace manual**

`useFieldArray` dari `react-hook-form` — perlu dicek apakah lib ini udah ke-install (dipakai `useForm` juga dari package sama, `useFieldArray` selalu tersedia bareng `react-hook-form` versi berapa pun yang udah dipasang di project, gak butuh dependency tambahan). `Plus`/`Trash2` dari `lucide-react` — `Plus` udah dipakai di file lain (`master/sparepart/page.tsx`), `Trash2` kemungkinan besar juga udah dipakai di tempat lain project (pola umum ikon hapus baris dinamis) — kalau ternyata belum pernah dipakai, `lucide-react` tetap nyediain export itu (bukan lib custom), jadi import aman tanpa perlu install apa pun.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/master/sparepart/[id]/sparepart-detail-client.tsx"
git commit -m "feat(fe): halaman detail sparepart - form barang masuk per-gulungan + tabel gulungan aktif"
```

---

### Task 12: Frontend — `stock-client.tsx` — tab Sparepart ikut dinamis

**Files:**
- Modify: `epos-frontend-web/src/app/(dashboard)/stock/stock-client.tsx`

Catatan: halaman "Barang Masuk" (`/stock`) itu terpisah dari halaman detail sparepart (Task 11) tapi punya form yang sama persis kebutuhannya (barang masuk sparepart via picker, bukan lewat halaman detail). Perubahan di sini SEJALAN sama Task 11 — `SparepartStockInTab` sekarang perlu tau `batchTracked` dari sparepart yang dipilih dan nampilin form yang sesuai.

- [ ] **Step 1: Tambah `batchTracked` ke interface `Sparepart`**

Cari (baris 75-81):

```typescript
interface Sparepart {
  id: string;
  name: string;
  unit: string;
  sellPrice: string;
  stock: string;
}
```

Ganti jadi:

```typescript
interface Sparepart {
  id: string;
  name: string;
  unit: string;
  sellPrice: string;
  stock: string;
  // Siklus sparepart-per-gulungan (2026-09-23).
  batchTracked: boolean;
}
```

- [ ] **Step 2: Rewrite `SparepartStockInTab`**

Ganti SELURUH fungsi `SparepartStockInTab` (baris 445-569, dari `function SparepartStockInTab() {` sampai penutup `}` sebelum komentar `// ----... Shared: picker...`) jadi:

```typescript
function SparepartStockInTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Sparepart | null>(null);

  const sparepartsQuery = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<Sparepart[]>('/spareparts'),
  });

  function selectSparepart(s: Sparepart) {
    setSelected(s);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pilih Sparepart</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemSearchPicker
            items={sparepartsQuery.data ?? []}
            isLoading={sparepartsQuery.isLoading}
            selectedId={selected?.id ?? null}
            onSelect={selectSparepart}
            search={search}
            onSearchChange={setSearch}
            emptyLabel="Tidak ada sparepart."
            renderSubtitle={(s) => `Stok: ${s.stock} ${s.unit} • ${formatRupiah(s.sellPrice)}`}
          />
        </CardContent>
      </Card>

      {!selected ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pilih sparepart dulu di kiri buat input barang masuk.
          </CardContent>
        </Card>
      ) : selected.batchTracked ? (
        <SparepartRollStockInForm
          sparepart={selected}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['spareparts'] })}
        />
      ) : (
        <SparepartFlatStockInForm
          sparepart={selected}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['spareparts'] })}
        />
      )}
    </div>
  );
}

function SparepartFlatStockInForm({
  sparepart,
  onSaved,
}: {
  sparepart: Sparepart;
  onSaved: () => void;
}) {
  const form = useForm<SparepartStockInValues>({
    resolver: zodResolver(sparepartStockInSchema),
    defaultValues: sparepartStockInEmptyValues,
  });

  const stockInMutation = useMutation({
    mutationFn: (values: SparepartStockInValues) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'sparepart',
        refId: sparepart.id,
        qty: Number(values.qty),
        buyPrice: Number(values.buyPrice),
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: () => {
      toast.success('Barang masuk sparepart tersimpan.');
      form.reset(sparepartStockInEmptyValues);
      onSaved();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{sparepart.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => stockInMutation.mutate(values))}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Qty Masuk ({sparepart.unit})</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="buyPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Harga Modal</FormLabel>
                  <FormControl>
                    <CurrencyInput {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Catatan</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Opsional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={stockInMutation.isPending}>
              {stockInMutation.isPending ? 'Menyimpan...' : 'Simpan Barang Masuk'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// Siklus sparepart-per-gulungan (2026-09-23) — sama persis pola formnya
// kayak BatchTrackedStockIn di sparepart-detail-client.tsx (form dipisah,
// TANPA tabel "Gulungan Aktif" di sini — picker sisi kiri udah cukup buat
// konteks halaman Barang Masuk ini, tabel detail per-gulungan ada di
// halaman detail sparepart kalau admin butuh lihat).
const rollStockInSchema = z.object({
  rolls: z
    .array(z.object({ length: requiredNumberField('Panjang wajib diisi') }))
    .min(1, 'Minimal 1 gulungan'),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  supplierName: z.string().optional(),
  note: z.string().optional(),
});
type RollStockInValues = z.infer<typeof rollStockInSchema>;
const rollStockInEmptyValues: RollStockInValues = {
  rolls: [{ length: '' }],
  buyPrice: '',
  supplierName: '',
  note: '',
};

function SparepartRollStockInForm({
  sparepart,
  onSaved,
}: {
  sparepart: Sparepart;
  onSaved: () => void;
}) {
  const form = useForm<RollStockInValues>({
    resolver: zodResolver(rollStockInSchema),
    defaultValues: rollStockInEmptyValues,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'rolls' });

  const stockInMutation = useMutation({
    mutationFn: (values: RollStockInValues) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'sparepart',
        refId: sparepart.id,
        rolls: values.rolls.map((r) => ({ length: Number(r.length) })),
        buyPrice: Number(values.buyPrice),
        supplierName: trimmedOrUndefined(values.supplierName),
        note: trimmedOrUndefined(values.note),
      }),
    onSuccess: () => {
      toast.success('Barang masuk sparepart tersimpan.');
      form.reset(rollStockInEmptyValues);
      onSaved();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan barang masuk.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{sparepart.name}</CardTitle>
        <CardDescription>Per gulungan — panjang boleh beda-beda tiap gulungan.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => stockInMutation.mutate(values))}
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <FormLabel>Gulungan ({sparepart.unit})</FormLabel>
              {fields.map((field, idx) => (
                <div key={field.id} className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name={`rolls.${idx}.length`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input inputMode="decimal" placeholder={`Panjang gulungan #${idx + 1}`} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={fields.length === 1}
                    onClick={() => remove(idx)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => append({ length: '' })}
              >
                <Plus className="size-4" />
                Tambah Gulungan
              </Button>
            </div>
            <FormField
              control={form.control}
              name="buyPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Harga Modal (berlaku semua gulungan)</FormLabel>
                  <FormControl>
                    <CurrencyInput {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="supplierName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supplier</FormLabel>
                  <FormControl>
                    <Input placeholder="Opsional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Catatan</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Opsional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={stockInMutation.isPending}>
              {stockInMutation.isPending ? 'Menyimpan...' : 'Simpan Barang Masuk'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Tambah import `useFieldArray`, `Plus`, `Trash2`, `CardDescription` (kalau belum)**

Cari baris import di paling atas file:

```typescript
import { useForm } from 'react-hook-form';
```

Ganti jadi:

```typescript
import { useForm, useFieldArray } from 'react-hook-form';
```

Cari:

```typescript
import { Search } from 'lucide-react';
```

Ganti jadi:

```typescript
import { Search, Plus, Trash2 } from 'lucide-react';
```

Cek import `CardDescription` — file ini UDAH mengimpor `CardDescription` di baris `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';` (dipakai `ProductStockInTab`), jadi gak perlu tambahan.

- [ ] **Step 4: Trace manual**

`sparepartStockInSchema`/`sparepartStockInEmptyValues`/`StockInResult` yang lama (baris 436-443 & 96-99) masih dipakai `SparepartFlatStockInForm` — TIDAK dihapus, cuma dipindah dari dipakai `SparepartStockInTab` langsung jadi dipakai sub-komponen barunya. `ItemSearchPicker` generic-nya tetap kepake sama persis (gak berubah). Query key `['spareparts']` tetap 1 sumber data buat picker DUA form (flat & roll) — `onSaved` callback masing2 form invalidate query yang sama, picker otomatis refresh angka stok abis submit di form mana pun.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/stock/stock-client.tsx"
git commit -m "feat(fe): halaman Barang Masuk - tab Sparepart dinamis (flat vs per-gulungan)"
```

---

## Setelah semua task selesai

- [ ] **Task 13: Review akhir + sinkron ke device**

1. Baca ulang SEMUA file yang berubah (Task 1-12) sekali lagi end-to-end, pastikan gak ada sisa referensi ke `IsIn`/`kind==='product'`-only di `stock-opname.dto.ts`/`OpnameItemDto` yang kelewat, dan `ItemCost.stock` gak ada lagi tempat yang baca sebagai `number` mentah dari `$queryRawUnsafe` tanpa `Number()`.
2. Sync semua file berubah ke device (`device_commit_files`) SETELAH tiap task di-approve reviewer — bukan ditumpuk di akhir (ikutin pola Point 1: sync per-task, bukan sekali di ujung).
3. Kasih tau user:
   - **Langkah manual WAJIB** (ada perubahan schema): `npx prisma generate` (regenerate Prisma Client — `Sparepart.batchTracked` & `ItemCost.stock: Decimal` field baru) LALU `npx prisma migrate deploy` (apply migration `20260923000000_sparepart_batch_tracking` ke DB beneran) di folder `epos-backend`, BARU `npm run build` & `npx jest` buat verifikasi.
   - **Daftar file yang berubah** — backend: `schema.prisma`, migration baru, `stock-locking.service.ts`(+spec), `pos-calc.util.ts`(+spec), `pos.service.ts`, `stock-in.dto.ts`, `stock-opname.dto.ts`, `stock.service.ts`, `create-sparepart.dto.ts`, `update-sparepart.dto.ts`, `spareparts.service.ts`, `spareparts.controller.ts`, `material-requests.service.ts`. Frontend: `master/sparepart/page.tsx`, `master/sparepart/[id]/sparepart-detail-client.tsx`, `stock/stock-client.tsx`.

---

## Task 14 (perbaikan dari review holistik Task 13): cegah `Sparepart.stock` mirror phantom pas create/toggle `batchTracked`

**Bug yang ditemukan:** `SparepartsService.create()` menerima `dto.stock` mentah-mentah dan langsung set jadi `Sparepart.stock` TANPA pernah membuat baris `item_costs` — walau `dto.batchTracked=true`. Sama, `SparepartsService.update()` gak nolak toggle `batchTracked` dari `false`→`true` walau `Sparepart.stock` existing masih nonzero. Di frontend, field "Stok Awal" (`master/sparepart/page.tsx`) selalu tampil pas create, gak dikondisikan ke checkbox `batchTracked`.

Akibatnya: sparepart `batchTracked=true` bisa punya `Sparepart.stock` mirror nonzero TANPA baris `item_costs` yang mendukungnya ("stok phantom"). UI (list, badge, picker barang-masuk) nunjuk ada stok, tapi checkout POS / `MaterialRequestsService.markUsed` bakal gagal "Stok tidak cukup" (karena `StockLockingService.lockAndDeduct` baca dari `item_costs`, bukan mirror). Gak ada jalur recovery via opname (opname sparepart batch-tracked WAJIB nunjuk `itemCostId`, tapi gak ada batch yang bisa ditunjuk).

**Keputusan desain:** sparepart `batchTracked=true` HARUS selalu mulai dari stok 0 — stok pertamanya wajib masuk lewat alur barang-masuk (`stock/in`, yang beneran bikin baris `item_costs`), bukan lewat field "Stok Awal" pas create. Sama, toggle `batchTracked` `false`→`true` cuma boleh kalau `Sparepart.stock` existing-nya udah 0 (kalau belum, admin harus nolin dulu lewat opname, baru toggle).

**Files:**
- Modify: `epos-backend/src/spareparts/spareparts.service.ts`
- Modify: `epos-frontend-web/src/app/(dashboard)/master/sparepart/page.tsx`

- [ ] **Step 1: Guard di `SparepartsService.create()` dan `update()`**

Cari (backend, `src/spareparts/spareparts.service.ts`):

```typescript
  create(dto: CreateSparepartDto) {
    return this.prisma.sparepart.create({
      data: { ...dto, batchTracked: dto.batchTracked ?? false, active: true },
    });
  }
```

Ganti jadi:

```typescript
  /** Siklus sparepart-per-gulungan (2026-09-23) — sparepart batchTracked
   * WAJIB mulai dari stok 0. Kalau dibolehin isi `stock` langsung di sini,
   * `Sparepart.stock` (mirror) bakal nonzero TANPA baris `item_costs` yang
   * mendukungnya ("stok phantom") — checkout/markUsed bakal gagal "stok
   * tidak cukup" walau UI nunjuk ada stok, dan gak ada jalur recovery lewat
   * opname (opname batch-tracked wajib nunjuk itemCostId yang gak pernah
   * ada). Solusinya: paksa stok awal masuk lewat alur barang-masuk beneran
   * (bikin baris item_costs), bukan field ini. */
  create(dto: CreateSparepartDto) {
    if (dto.batchTracked && dto.stock > 0) {
      throw new BadRequestException(
        'Sparepart per-gulungan gak bisa punya stok awal saat dibuat — tambahkan gulungan pertama lewat menu Barang Masuk setelah sparepart ini dibuat.',
      );
    }
    return this.prisma.sparepart.create({
      data: { ...dto, batchTracked: dto.batchTracked ?? false, active: true },
    });
  }
```

Cari:

```typescript
  /** Edit sparepart setelah dibuat — sama alasannya kayak ProductsService.update. */
  async update(id: string, dto: UpdateSparepartDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.sparepart.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sparepart tidak ditemukan');

    const sparepart = await this.prisma.sparepart.update({ where: { id }, data: dto });
```

Ganti jadi:

```typescript
  /** Edit sparepart setelah dibuat — sama alasannya kayak ProductsService.update. */
  async update(id: string, dto: UpdateSparepartDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.sparepart.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sparepart tidak ditemukan');

    // Siklus sparepart-per-gulungan (2026-09-23) — sama alasan kayak guard
    // di create(): toggle false->true selagi masih ada stok flat bakal
    // nyisain Sparepart.stock phantom yang gak ada item_costs-nya.
    if (dto.batchTracked === true && !existing.batchTracked && Number(existing.stock) > 0) {
      throw new BadRequestException(
        `Gak bisa aktifkan pelacakan per-gulungan selagi masih ada stok flat (${existing.stock} ${existing.unit}) — nolkan dulu stoknya lewat opname, baru aktifkan pelacakan per-gulungan.`,
      );
    }

    const sparepart = await this.prisma.sparepart.update({ where: { id }, data: dto });
```

- [ ] **Step 2: Frontend — sembunyikan "Stok Awal" pas `batchTracked` dicentang, paksa value ke `'0'`**

Cari (`epos-frontend-web/src/app/(dashboard)/master/sparepart/page.tsx`), FormField `batchTracked`:

```typescript
              <FormField
                control={form.control}
                name="batchTracked"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div>
                      <FormLabel className="font-normal">Lacak per gulungan/batch</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Buat barang meteran (pipa, kabel) yang panjangnya beda-beda tiap kedatangan.
                        Bisa diubah lagi nanti.
                      </p>
                    </div>
                  </FormItem>
                )}
              />
```

Ganti jadi:

```typescript
              <FormField
                control={form.control}
                name="batchTracked"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          // Siklus sparepart-per-gulungan (2026-09-23) —
                          // sparepart batchTracked wajib mulai dari stok 0
                          // (lihat guard di SparepartsService.create()),
                          // jadi begitu dicentang paksa field "Stok Awal"
                          // balik ke 0 biar gak ada value nyangkut yang
                          // bakal ditolak backend pas submit.
                          if (checked) form.setValue('stock', '0');
                        }}
                      />
                    </FormControl>
                    <div>
                      <FormLabel className="font-normal">Lacak per gulungan/batch</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Buat barang meteran (pipa, kabel) yang panjangnya beda-beda tiap kedatangan.
                        Bisa diubah lagi nanti.
                      </p>
                    </div>
                  </FormItem>
                )}
              />
```

Cari:

```typescript
              {!editing && (
                <FormField
                  control={form.control}
                  name="stock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stok Awal</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
```

Ganti jadi:

```typescript
              {!editing &&
                (form.watch('batchTracked') ? (
                  <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    Sparepart per-gulungan gak bisa diisi stok awal di sini — tambahkan gulungan
                    pertama lewat menu Barang Masuk setelah sparepart ini dibuat.
                  </p>
                ) : (
                  <FormField
                    control={form.control}
                    name="stock"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Stok Awal</FormLabel>
                        <FormControl>
                          <Input inputMode="numeric" placeholder="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
```

- [ ] **Step 3: Trace manual**

Backend: `create()` — kalau `batchTracked=false` (default), behavior identik persis kayak sebelumnya (guard cuma nge-cek `dto.batchTracked && dto.stock>0`, gak pernah true kalau `batchTracked` falsy). Kalau `batchTracked=true` DAN `dto.stock===0` (yang sekarang JADI SATU-SATUNYA nilai yang bisa dikirim frontend karena Step 2), lolos guard, `Sparepart.stock` dibuat 0 — konsisten sama keputusan desain (mirror mulai dari 0, naik nanti pas barang-masuk beneran bikin `item_costs`+update mirror, kode itu udah ada dari Task 6). `update()` — toggle `batchTracked` yang gak nyentuh existing stok (mis. sparepart baru yang emang belum ada stoknya, atau sparepart yang emang FLAT terus gak pernah diubah `batchTracked`-nya) tetep lolos tanpa masalah; existing behavior `update()` buat field lain (`name`,`sku`,`sellPrice`,dst) gak kesentuh sama sekali. Guard di `update()` cuma nge-block kombinasi spesifik: `dto.batchTracked===true` (eksplisit dikirim true) DAN `existing.batchTracked` masih `false` DAN `existing.stock>0` — kombinasi lain (toggle `true→false`, dto gak nyertain `batchTracked` sama sekali, atau `existing.stock` udah 0) semua lolos.

Frontend: checkbox `batchTracked` di-toggle checked → `form.setValue('stock','0')` jalan bareng, field "Stok Awal" ganti jadi teks info (karena `form.watch('batchTracked')` sekarang `true`), jadi value `stock` yang di-submit PASTI `'0'` (`requiredNumberField` di schema tetep lolos karena `'0'` itu valid angka, cuma nol). Toggle balik ke unchecked → field input balik muncul lagi, restore ke value sebelumnya user ketik (react-hook-form gak ilangin state field, cuma UI-nya yang disembunyiin pas checked). Dialog **edit** (`editing=true`) gak kena section ini sama sekali (`{!editing && ...}`), behavior guard `update()` di baliknya cuma keliatan lewat pesan error kalau backend nolak — sudah di-handle generic sama `onError` mutation (`toast.error(err instanceof ApiError ? err.message : ...)`) yang udah ada, gak perlu tambahan apa pun di frontend buat itu.

- [ ] **Step 4: Commit**

```bash
git add src/spareparts/spareparts.service.ts
git commit -m "fix(be): cegah Sparepart.stock phantom pas create/toggle batchTracked"
```

```bash
git add "src/app/(dashboard)/master/sparepart/page.tsx"
git commit -m "fix(fe): sembunyikan Stok Awal pas batchTracked dicentang, cegah stok phantom"
```

---
