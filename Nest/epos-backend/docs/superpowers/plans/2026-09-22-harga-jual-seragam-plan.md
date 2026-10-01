# Harga Jual Seragam per Produk (Point 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Product` punya SATU `sellPrice` seragam (bukan lagi per-batch `ItemCost.sellPrice`), checkout jadi FIFO otomatis lintas batch (bukan kasir manual pilih batch), warning "jual di bawah modal" banding ke MAX(buyPrice) batch yang masih berstok, dan kasir bisa override harga jual manual per baris pas checkout.

**Architecture:** `Product` nambah kolom `sellPrice` (backfill dari batch terbaru tiap produk). `ItemCost.sellPrice` TETAP ada di skema (gak di-drop) tapi berhenti dipakai buat `kind='product'` — batch baru cuma nulis 0 placeholder ke situ (pola yang sama kayak `kind='sparepart'` udah pakai). `StockLockingService.lockAndDeductProductBatch` (manual-pick-batch) DIHAPUS — `PosService.checkout` pindah pakai `lockAndDeduct` (FIFO, method yang udah ada tapi belum ada caller buat `kind='product'`), yang di-rewrite biar (a) baca harga jual dari `Product.sellPrice` bukan batch, (b) balikin `buyPrice` = MAX dari SEMUA batch berstok (bukan cuma batch pertama yang kena FIFO), (c) balikin daftar `batchDeductions` (batch mana aja + qty berapa yang beneran kepotong) biar `StockMovement` tetap presisi per-batch walau FIFO nembus beberapa batch sekaligus. `CheckoutItemDto` kehilangan `itemCostId` (gak relevan lagi), nambah `unitPriceOverride` opsional buat override harga manual di checkout.

**Tech Stack:** NestJS 11, Prisma 7 (raw SQL `$queryRawUnsafe`/`$executeRawUnsafe` buat row-locking `FOR UPDATE`), PostgreSQL, class-validator, Jest, Next.js App Router, react-hook-form + zod, TanStack Query.

**Scope:** Backend (`epos-backend`) + Frontend (`epos-frontend-web`) — 1 plan, karena API & UI-nya berubah barengan (gak ada versi lama yang perlu tetap jalan sementara). Spec lengkap (termasuk Point 2/3/4 yang BELUM masuk plan ini): `docs/superpowers/specs/2026-09-22-inventaris-lanjutan-design.md`.

---

## Ringkasan Perubahan Skema

| Sebelum | Sesudah |
|---|---|
| `products.sell_price` — TIDAK ADA (dihapus di siklus batch-cost 2026-09) | **Ditambah lagi** — harga jual seragam, satu-satunya sumber harga jual produk |
| `item_costs.sell_price` DIPAKAI buat `kind='product'` (per-batch) | Berhenti dipakai buat `kind='product'` (ditulis 0 placeholder, sama kayak `kind='sparepart'`). Kolom TETAP ADA (gak di-drop — hindari migrasi destruktif) |

---

### Task 1: Migrasi Skema — `Product.sellPrice`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260922000000_uniform_sell_price/migration.sql`

- [ ] **Step 1: Tambah field `sellPrice` ke model `Product`**

Di `prisma/schema.prisma`, cari model `Product` (`model Product {`). Ganti komentar + field `photoUrl` yang sekarang:
```prisma
  // sellPrice & stock DIHAPUS dari sini (Siklus batch-cost 2026-09) —
  // pindah ke ItemCost, 1 produk sekarang bisa punya banyak "batch" harga
  // (beda supplier/kedatangan barang, harga modal & jual beda-beda).
  photoUrl    String?  @map("photo_url")
```
jadi:
```prisma
  // stock TETAP agregat dari ItemCost (banyak batch, beda modal per
  // supplier/kedatangan — lihat ProductsService.stockFor). sellPrice di
  // bawah ini BALIK LAGI jadi kolom langsung di sini (Siklus harga-seragam
  // 2026-09-22) — toko cuma mau SATU harga jual per produk, gak peduli
  // stoknya campuran dari berapa banyak batch/supplier. `ItemCost.sellPrice`
  // TETAP ada di skema (gak di-drop) tapi UDAH GAK DIPAKAI lagi buat
  // `kind='product'` — batch baru nulis 0 placeholder ke situ, sama pola
  // kayak `kind='sparepart'` yang emang dari awal gak pernah pakai kolom
  // itu (lihat komentar di model ItemCost).
  sellPrice   Decimal  @map("sell_price") @db.Decimal(14, 2)
  photoUrl    String?  @map("photo_url")
```

- [ ] **Step 2: Update komentar model `ItemCost`**

Cari `model ItemCost {`, ganti komentar block di atasnya (yang sekarang mulai `// Siklus batch-cost (2026-09) — 1 baris = 1 "batch"...`) jadi:
```prisma
// Siklus batch-cost (2026-09) — 1 baris = 1 "batch" (kedatangan barang),
// PUNYA harga modal sendiri (`buyPrice`, beda-beda per supplier/kedatangan).
// `kind='product'` boleh banyak baris per `refId` (banyak batch sekaligus).
// `kind='sparepart'` TETAP dijaga di kode (StockService) cuma 1 baris per
// `refId` (upsert) — sparepart gak ikut sistem batch.
//
// `sellPrice` DI SINI GAK DIPAKAI LAGI SAMA SEKALI (Siklus harga-seragam
// 2026-09-22) — kolom dibiarin ada (gak di-drop, hindari migrasi
// destruktif) tapi baris BARU (product maupun sparepart) selalu nulis 0 ke
// situ. Harga jual produk sekarang SATU angka seragam di `Product.sellPrice`,
// harga jual sparepart tetap di `Sparepart.sellPrice`.
model ItemCost {
```

- [ ] **Step 3: Tulis migration.sql**

Buat folder `prisma/migrations/20260922000000_uniform_sell_price/` isi file `migration.sql`:
```sql
-- Siklus harga-seragam (2026-09-22): Product.sellPrice balik jadi kolom
-- langsung (satu harga jual per produk, bukan per-batch lagi).

-- 1) Tambah kolom baru (nullable dulu, diisi step 2, dikunci NOT NULL step 3).
ALTER TABLE "products" ADD COLUMN "sell_price" DECIMAL(14,2);

-- 2) Backfill dari batch TERBARU (created_at paling akhir) tiap produk yang
--    udah pernah di-stock-in. Produk yang BELUM PERNAH ada batch item_costs
--    (belum pernah di-stock-in sama sekali) dapet 0 — gak ada histori harga
--    buat dijadiin acuan, admin wajib isi manual lewat Master Data sebelum
--    produk itu kelihatan "lengkap".
UPDATE "products" p
SET "sell_price" = COALESCE((
  SELECT ic."sell_price" FROM "item_costs" ic
  WHERE ic."kind" = 'product' AND ic."ref_id" = p."id"
  ORDER BY ic."created_at" DESC
  LIMIT 1
), 0);

-- 3) Kunci NOT NULL.
ALTER TABLE "products" ALTER COLUMN "sell_price" SET NOT NULL;
```

- [ ] **Step 4: Validasi schema & generate client**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: selesai tanpa error, `@prisma/client` ke-update dengan `Product.sellPrice`.

- [ ] **Step 5: Jalankan migrasi & verifikasi data**

Run: `npx prisma migrate deploy`
Expected: migrasi `20260922000000_uniform_sell_price` berhasil.

Verifikasi manual (`npx prisma studio` atau `psql`):
```sql
-- Produk yang PUNYA batch aktif tapi sell_price hasil backfill = 0 — berarti
-- batch-nya semua sell_price 0 juga (data lama aneh) ATAU backfill salah.
-- Harus 0 baris (atau dicek manual satu-satu kalau ada).
SELECT p.id, p.name, p.sell_price
FROM products p
WHERE p.sell_price = 0
  AND EXISTS (SELECT 1 FROM item_costs ic WHERE ic.kind='product' AND ic.ref_id=p.id AND ic.stock>0);
```
Expected: kalau ada baris, cek manual apa memang produk itu batch-nya sell_price 0 (data lama) — bukan bug backfill.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260922000000_uniform_sell_price
git commit -m "feat(db): tambah Product.sellPrice (harga jual seragam per produk)"
```

---

### Task 2: `StockLockingService` — FIFO Produk Baca `Product.sellPrice` + MAX(buyPrice)

**Files:**
- Modify: `src/common/services/stock-locking.service.ts`
- Test: `src/common/services/stock-locking.service.spec.ts` (replace seluruh isi)

- [ ] **Step 1: Tulis test buat `lockAndDeduct` (kind='product') yang BARU**

`src/common/services/stock-locking.service.spec.ts` (replace SELURUH isi file):
```ts
import { BadRequestException } from '@nestjs/common';
import { StockLockingService } from './stock-locking.service';

// Beda dari fakeTx lama (1 hasil query dipakai buat SEMUA panggilan) —
// lockAndDeduct(kind='product') sekarang manggil $queryRawUnsafe 2x
// (query produk, lalu query batch), jadi butuh hasil BERBEDA per panggilan
// berurutan.
function fakeTxSequence(queryResults: unknown[][]) {
  const queryMock = jest.fn();
  queryResults.forEach((r) => queryMock.mockResolvedValueOnce(r));
  return {
    $queryRawUnsafe: queryMock,
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  } as any;
}

describe('StockLockingService.lockAndDeduct (kind=product)', () => {
  it('FIFO motong batch TERTUA dulu, harga jual dari Product.sellPrice, buyPrice = MAX batch berstok', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [
        { id: 'batch-lama', stock: 2, buy_price: '2900000' },
        { id: 'batch-baru', stock: 5, buy_price: '3100000' },
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
    });
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE item_costs SET stock = stock - $1'),
      2,
      'batch-lama',
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE item_costs SET stock = stock - $1'),
      1,
      'batch-baru',
    );
  });

  it('buyPrice tetap MAX dari SEMUA batch berstok walau qty cuma abisin batch pertama', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [
        { id: 'batch-a', stock: 5, buy_price: '2900000' },
        { id: 'batch-b', stock: 5, buy_price: '3100000' },
      ],
    ]);

    const result = await service.lockAndDeduct(tx, 'product', 'produk-1', 1);

    expect(result.buyPrice).toBe(3100000);
    expect(result.batchDeductions).toEqual([{ itemCostId: 'batch-a', qty: 1 }]);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
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

  it('lempar BadRequestException kalau total stok semua batch gak cukup', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [{ id: 'batch-1', stock: 2, buy_price: '2900000' }],
    ]);
    await expect(service.lockAndDeduct(tx, 'product', 'produk-1', 5)).rejects.toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Run test, pastikan gagal**

Run: `npx jest src/common/services/stock-locking.service.spec.ts`
Expected: FAIL — hasil `unitPrice`/`buyPrice`/`batchDeductions` gak cocok (masih pakai implementasi lama).

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
  // product: MAX(buyPrice) dari SEMUA batch yang MASIH BERSTOK (skenario
  // termahal, dipakai warning "jual di bawah modal") — BUKAN cuma batch yang
  // kena FIFO-deduct. sparepart: selalu null (gak ada batch).
  buyPrice: number | null;
  // Cuma diisi kind='product' — daftar batch (ItemCost) yang BENERAN kepotong
  // stoknya lewat FIFO (bisa lebih dari 1 kalau qty nembus beberapa batch
  // sekaligus). Dipakai caller (PosService) buat bikin StockMovement PER-BATCH,
  // biar histori mutasi tetap presisi walau 1 baris cart bisa narik dari
  // beberapa batch.
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
   * Kunci & kurangi stok. `sparepart` — langsung di tabel `spareparts`.
   * `product` — FIFO lintas batch `item_costs` (batch TERTUA duluan).
   *
   * Siklus harga-seragam (2026-09-22) — sebelumnya method ini cuma dipakai
   * MaterialRequestsService (kind='sparepart' doang, lihat komentar di sana).
   * Sekarang PosService.checkout JUGA lewat sini buat kind='product' —
   * alur "kasir manual pilih batch" (`lockAndDeductProductBatch`, method
   * terpisah) DIHAPUS, checkout produk sekarang SELALU FIFO otomatis.
   * Harga jual produk dibaca dari `Product.sellPrice` (kolom langsung,
   * seragam) — BUKAN dari `item_costs.sell_price` per-batch lagi (kolom itu
   * udah gak dipakai buat `kind='product'`, lihat komentar di schema.prisma).
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
    const productRows = await tx.$queryRawUnsafe<
      { name: string; active: boolean; sell_price: unknown }[]
    >(`SELECT name, active, sell_price FROM products WHERE id = $1`, refId);
    const product = productRows[0];
    if (!product) throw new BadRequestException(`Produk ${refId} tidak ditemukan`);
    if (!product.active) throw new BadRequestException(`${product.name} tidak aktif`);

    const batches = await tx.$queryRawUnsafe<{ id: string; stock: number; buy_price: unknown }[]>(
      `SELECT id, stock, buy_price FROM item_costs
       WHERE kind = 'product' AND ref_id = $1 AND stock > 0
       ORDER BY created_at ASC FOR UPDATE`,
      refId,
    );

    let remaining = qty;
    let maxBuyPrice: number | null = null;
    const batchDeductions: { itemCostId: string; qty: number }[] = [];
    for (const batch of batches) {
      // MAX(buyPrice) dihitung dari SEMUA batch berstok, gak peduli kepotong
      // FIFO atau enggak — skenario "harga modal TERMAHAL" buat warning
      // below-cost (keputusan user 2026-09-22), bukan cuma batch yang narik.
      const buyPrice = Number(batch.buy_price);
      maxBuyPrice = maxBuyPrice === null ? buyPrice : Math.max(maxBuyPrice, buyPrice);

      if (remaining <= 0) continue;
      const take = Math.min(remaining, batch.stock);
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
   * SPAREPART SAJA. TIDAK cek `active`. Barang masuk produk selalu bikin
   * baris `item_costs` (batch) baru lewat `StockService.stockIn()` langsung
   * (`tx.itemCost.create`), gak lewat sini.
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

Catatan: method `lockAndDeductProductBatch` DIHAPUS total dari file ini (gak dipakai lagi — checkout sekarang lewat `lockAndDeduct`).

- [ ] **Step 4: Run test, pastikan lolos**

Run: `npx jest src/common/services/stock-locking.service.spec.ts`
Expected: PASS, 5 test lolos.

- [ ] **Step 5: Commit**

```bash
git add src/common/services/stock-locking.service.ts src/common/services/stock-locking.service.spec.ts
git commit -m "feat(stock): lockAndDeduct produk baca Product.sellPrice + MAX buyPrice batch berstok"
```

---

### Task 3: `ProductsService` + DTO — Field `sellPrice`

**Files:**
- Modify: `src/products/dto/create-product.dto.ts`
- Modify: `src/products/dto/update-product.dto.ts`
- Modify: `src/products/products.service.ts`

- [ ] **Step 1: Tambah `sellPrice` wajib ke `CreateProductDto`**

`src/products/dto/create-product.dto.ts` (replace seluruh file):
```ts
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() name: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() type?: string;
  // Kolom `products.pk` di DB itu DECIMAL(4,2) — maks 99.99. Divalidasi di
  // sini biar input ngawur (misal salah ketik "3435" instead of "3.5")
  // ditolak 400 yang jelas, bukan nge-crash 500 gara-gara numeric overflow di Postgres.
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsBoolean() inverter?: boolean;
  @IsOptional() @IsInt() btu?: number;
  @IsOptional() @IsInt() watt?: number;
  @IsOptional() @IsString() category?: string;
  // Siklus harga-seragam (2026-09-22) — sellPrice BALIK jadi field di sini
  // (sempat dihapus di siklus batch-cost, pindah ke per-batch). Wajib diisi
  // saat produk dibuat — inilah satu-satunya harga jual produk ini,
  // berlaku ke SEMUA batch (beda supplier/kedatangan cuma beda modal, harga
  // jualnya tetap 1). `stock` TETAP gak ada di sini — produk baru mulai
  // dengan 0 stok sampai di-stock-in lewat StockService.stockIn().
  @IsNumber() @Min(0) sellPrice: number;
}
```

- [ ] **Step 2: Tambah `sellPrice` opsional ke `UpdateProductDto`**

`src/products/dto/update-product.dto.ts` (replace seluruh file):
```ts
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// Field yang sama seperti CreateProductDto, semua opsional (PATCH parsial)
// KECUALI `stock` — itu TETAP gak ada di sini, satu-satunya jalur ubah stok
// StockService.stockIn() (bikin batch baru). `sellPrice` SEKARANG BOLEH
// diedit lewat sini (Siklus harga-seragam 2026-09-22) — ini satu-satunya
// tempat admin ubah harga jual produk, gak lagi lewat stock-in kayak sebelumnya.
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
  @IsOptional() @IsNumber() @Min(0) sellPrice?: number;
  // Nonaktifin produk yang udah gak dijual lagi tanpa hapus riwayatnya —
  // sama polanya kayak UsersService.toggleActive, cuma gak butuh pengaman
  // anti-kunci-diri-sendiri (produk bukan akun).
  @IsOptional() @IsBoolean() active?: boolean;
}
```

- [ ] **Step 3: Sederhanakan agregat harga di `products.service.ts`**

Di `src/products/products.service.ts`, ganti interface `ProductPriceAgg` + method `priceAggFor` (baris ~8-51) jadi:
```ts
/** Stok TETAP agregat dari batch aktif (item_costs, kind='product',
 * stock>0) — Siklus batch-cost 2026-09, gak berubah. Harga jual SEKARANG
 * kolom langsung di Product (Siklus harga-seragam 2026-09-22), gak perlu
 * diagregat lagi dari batch. */
private async stockFor(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await this.prisma.$queryRaw<{ ref_id: string; total_stock: string }[]>`
    SELECT ref_id, SUM(stock) AS total_stock
    FROM item_costs
    WHERE kind = 'product' AND stock > 0 AND ref_id = ANY(${productIds})
    GROUP BY ref_id
  `;
  return new Map(rows.map((r) => [r.ref_id, Number(r.total_stock)]));
}
```

Lalu ganti `findAll()` & `findOne()` (yang manggil `priceAggFor`) jadi:
```ts
async findAll() {
  const products = await this.prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  const stockMap = await this.stockFor(products.map((p) => p.id));
  return products.map((p) => ({ ...p, stock: stockMap.get(p.id) ?? 0 }));
}

async findOne(id: string) {
  const product = await this.prisma.product.findUnique({ where: { id } });
  if (!product) throw new NotFoundException('Produk tidak ditemukan');
  const stockMap = await this.stockFor([id]);
  return { ...product, stock: stockMap.get(id) ?? 0 };
}
```
(`product.sellPrice` otomatis ikut ke-spread dari `...product` — kolom asli sekarang, gak perlu ditambahin manual kayak `stock`.)

`create()`, `update()`, `findBatches()` TIDAK berubah (DTO spread generik, otomatis bawa `sellPrice` begitu ditambah ke DTO).

- [ ] **Step 4: Commit**

```bash
git add src/products/dto/create-product.dto.ts src/products/dto/update-product.dto.ts src/products/products.service.ts
git commit -m "feat(products): Product.sellPrice jadi field asli, sederhanakan agregat harga"
```

---

### Task 4: `StockService` — Barang Masuk Produk Gak Minta `sellPrice` Lagi

**Files:**
- Modify: `src/stock/dto/stock-in.dto.ts`
- Modify: `src/stock/stock.service.ts`

- [ ] **Step 1: Hapus field `sellPrice` dari `StockInDto`**

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

  // Siklus harga-seragam (2026-09-22) — sellPrice DIHAPUS dari sini. Harga
  // jual produk sekarang SATU angka seragam di Product.sellPrice, diatur
  // lewat Master Data Produk (create/update), BUKAN per-batch pas barang
  // masuk lagi. Warning "jual di bawah modal" pas barang masuk (StockService
  // .stockIn) sekarang banding buyPrice batch baru INI ke Product.sellPrice
  // yang UDAH ADA.

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
(`ValidateIf` yang tadinya nge-gate `sellPrice` wajib buat `kind='product'` ikut hilang bareng field-nya — gak ada lagi yang butuh `ValidateIf` di file ini.)

- [ ] **Step 2: Ganti cabang `kind==='product'` di `stockIn()`**

Di `src/stock/stock.service.ts`, cari komentar `// kind === 'product' — selalu bikin batch (item_costs) BARU.` (awal cabang product), ganti SELURUH blok itu (dari komentar itu sampai `return { kind: 'product' as const, ... };` sebelum penutup `});` transaksi) jadi:
```ts
        // kind === 'product' — selalu bikin batch (item_costs) BARU. Siklus
        // harga-seragam (2026-09-22): sellPrice GAK lagi diinput di sini —
        // dibaca dari Product.sellPrice (satu-satunya sumber harga jual
        // produk). Batch baru nulis 0 ke item_costs.sell_price (placeholder,
        // gak dipakai — sama pola kayak kind='sparepart').
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
```

- [ ] **Step 3: Commit**

```bash
git add src/stock/dto/stock-in.dto.ts src/stock/stock.service.ts
git commit -m "feat(stock): barang masuk produk gak minta sellPrice lagi, banding ke Product.sellPrice"
```

---

### Task 5: `PosService` — Checkout FIFO Otomatis + Override Harga Manual

**Files:**
- Modify: `src/pos/dto/checkout.dto.ts`
- Modify: `src/pos/pos.service.ts`

- [ ] **Step 1: `CheckoutItemDto` — hapus `itemCostId`, tambah `unitPriceOverride`**

Di `src/pos/dto/checkout.dto.ts`, ganti class `CheckoutItemDto` jadi:
```ts
export class CheckoutItemDto {
  @IsIn(['product', 'sparepart', 'service']) kind: 'product' | 'sparepart' | 'service';
  @IsString() @IsNotEmpty() refId: string;

  @IsNumber() @Min(0.01) qty: number;

  // Diskon nominal khusus baris ini, numpuk (bukan gantiin) diskon
  // level-transaksi di bawah. Dibandingkan ke buyPrice batch (lewat
  // checkBelowCost) buat warning "jual di bawah modal", cuma berlaku buat
  // kind='product'.
  @IsOptional() @IsNumber() @Min(0) discount?: number;

  // BARU (Siklus harga-seragam 2026-09-22) — override manual harga jual
  // baris ini, cuma relevan buat kind='product'. Kalau dikirim, INI yang
  // dipakai sebagai unitPrice baris tsb (bukan Product.sellPrice default).
  // Kasir/siapapun yang pegang kasir boleh ubah — gak dibatasi role admin.
  // Warning "jual di bawah modal" tetap jalan berdasarkan harga FINAL ini
  // (dikurangi discount di atas), dibanding ke MAX(buyPrice) batch berstok.
  @IsOptional() @IsNumber() @Min(0) unitPriceOverride?: number;
}
```
(field `itemCostId` DIHAPUS total dari class ini — checkout gak lagi nunjuk batch spesifik, FIFO otomatis yang nentuin.)

- [ ] **Step 2: Import type `LockedItem` — dipakai tipe `Map` di Step 4**

Cari baris import `StockLockingService` di paling atas file (`import { StockLockingService } from '../common/services/stock-locking.service';`), ganti jadi:
```ts
import { StockLockingService, LockedItem } from '../common/services/stock-locking.service';
```

- [ ] **Step 3: Update `lineKey()` — sederhanakan jadi selalu `${kind}:${refId}`**

Di `src/pos/pos.service.ts`, ganti komentar + fungsi `lineKey` (baris ~30-36) jadi:
```ts
/** Key unik per BARIS cart. Siklus harga-seragam (2026-09-22) — produk
 * SEKARANG selalu `product:${refId}` juga (bukan lagi `product:${itemCostId}`)
 * karena checkout udah gak nunjuk batch spesifik lagi (FIFO otomatis lintas
 * batch), jadi 2 baris produk yang sama SEKARANG dianggap 1 baris (kayak
 * sparepart/service dari awal). */
function lineKey(item: { kind: string; refId: string }): string {
  return `${item.kind}:${item.refId}`;
}
```

- [ ] **Step 4: Update komentar di atas method `checkout()`**

Ganti paragraf komentar (baris ~50-62, yang sekarang bilang "kasir sekarang manual milih BATCH...") jadi:
```ts
  /**
   * Port 1:1 dari checkout_transaction RPC (pos_functions.sql) + tambahan
   * lock-urut-refId (cegah deadlock antar checkout paralel) — lihat versi
   * lama buat histori lengkap.
   *
   * Siklus harga-seragam (2026-09-22): kind='product' SEKARANG auto-FIFO
   * lintas batch (`StockLockingService.lockAndDeduct`, bukan lagi manual
   * pilih batch lewat `itemCostId`). Harga jual default dari
   * `Product.sellPrice`, tapi tiap baris BOLEH di-override manual
   * (`item.unitPriceOverride`) — kasir bisa nego harga langsung di kasir.
   * Boleh kasih diskon per-baris, dan checkout bisa balik
   * `{status:'confirm_required', warnings}` (HTTP 200, bukan error) kalau
   * ada baris yang harga efektifnya di bawah/pas MAX(buyPrice) batch yang
   * masih berstok DAN request belum bawa `confirmOverride:true` — lihat
   * `ConfirmationRequiredException`.
   */
```

- [ ] **Step 5: Sederhanakan `demand` map — hapus `itemCostId`**

Ganti blok pembangunan `demand` (baris ~118-140) jadi:
```ts
        // Gabung SEMUA kebutuhan lock stok jadi satu peta, di-lock urut key
        // (cegah deadlock). Produk & sparepart sama-sama dikunci per refId
        // sekarang (produk gak lagi per-batch, lihat lineKey).
        const demand = new Map<string, { kind: 'product' | 'sparepart'; refId: string; qty: number }>();
        for (const item of dto.items) {
          if (item.kind === 'service') continue;
          demand.set(lineKey(item), { kind: item.kind, refId: item.refId, qty: item.qty });
        }
        for (const line of packageLines) {
          if (!line.sparepartId) continue;
          const key = `sparepart:${line.sparepartId}`;
          const d = demand.get(key);
          if (d) d.qty += line.qty;
          else demand.set(key, { kind: 'sparepart', refId: line.sparepartId, qty: line.qty });
        }

        const stockResults = new Map<string, LockedItem>();
        for (const key of [...demand.keys()].sort()) {
          const d = demand.get(key)!;
          const result = await this.stockLocking.lockAndDeduct(tx, d.kind, d.refId, d.qty);
          stockResults.set(key, result);
        }
```
(ini gantiin blok `demand`/`stockResults` yang lama SEKALIGUS — termasuk `if (d.kind === 'product' ? lockAndDeductProductBatch(...) : lockAndDeduct(...))` yang sekarang selalu `lockAndDeduct` buat dua-duanya.)

- [ ] **Step 6: Update pembangunan `priced` map — pakai `unitPriceOverride`**

Cari blok `const priced = new Map<...>` (baris ~152-169), ganti cabang `else if (item.kind === 'product')` jadi:
```ts
          } else if (item.kind === 'product') {
            const locked = stockResults.get(lineKey(item))!;
            const unitPrice = item.unitPriceOverride ?? locked.unitPrice;
            priced.set(lineKey(item), { name: locked.name, unit: locked.unit, unitPrice, buyPriceSnapshot: locked.buyPrice });
          } else {
```
(baris `} else {` di atas nyambung ke cabang sparepart yang SUDAH ADA di bawahnya, gak berubah — cuma cabang product-nya yang diganti.)

- [ ] **Step 7: Update push ke `belowCostWarnings` — `itemCostId` jadi `null`**

Di blok cek below-cost (baris ~219-254), cari:
```ts
          if (isBelowCost) {
            belowCostWarnings.push({
              refId: item.refId,
              itemCostId: item.itemCostId!,
              name: p.name,
```
ganti jadi:
```ts
          if (isBelowCost) {
            belowCostWarnings.push({
              refId: item.refId,
              // null — checkout sekarang FIFO otomatis lintas batch, gak ada
              // 1 batch spesifik yang "ditunjuk" kasir lagi (beda dari
              // barang masuk yang juga null tapi alasannya "batch belum
              // kebuat").
              itemCostId: null,
              name: p.name,
```
(baris-baris lain di dalam objek push itu — `buyPrice`, `sellPrice: p.unitPrice`, `discount`, `effectivePrice` — TIDAK berubah.)

- [ ] **Step 8: Ganti pembuatan `StockMovement` per baris `TransactionItem` — pakai `batchDeductions`**

Cari blok (di dalam loop `for (const item of dto.items)` yang bikin `tx.transactionItem.create` lalu `tx.stockMovement.create`):
```ts
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
```
ganti jadi:
```ts
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

- [ ] **Step 9: Commit**

```bash
git add src/pos/dto/checkout.dto.ts src/pos/pos.service.ts
git commit -m "feat(pos): checkout produk FIFO otomatis + override harga jual manual per baris"
```

---

### Task 6: Frontend — Master Data Produk (List + Form)

**Files:**
- Modify: `src/app/(dashboard)/master/produk/page.tsx`

- [ ] **Step 1: Ganti interface `Product` — `sellPriceMin`/`sellPriceMax` jadi `sellPrice`**

Ganti (baris ~50-73):
```ts
// Padanan model Product Prisma (products.controller.ts / schema.prisma).
// `pk`/`sellPrice` DECIMAL -> Prisma Decimal -> string lewat JSON. `stock`
// BUKAN kolom asli (agregat dari batch item_costs via
// ProductsService.stockFor, dikirim backend sebagai field tambahan di
// respons GET). `sellPrice` KEBALIKAN — kolom ASLI lagi (Siklus
// harga-seragam 2026-09-22), satu harga jual seragam per produk.
interface Product {
  id: string;
  sku: string | null;
  name: string;
  brand: string | null;
  type: string | null;
  pk: string | null;
  inverter: boolean;
  btu: number | null;
  watt: number | null;
  warranty: string | null;
  stock: number;
  sellPrice: string;
  description: string | null;
  category: string | null;
  active: boolean;
}
```

- [ ] **Step 2: Tambah `sellPrice` ke schema, empty values, `toFormValues`**

Ganti `productSchema` (baris ~75-87):
```ts
const productSchema = z.object({
  name: z.string().min(1, 'Wajib diisi'),
  brand: z.string().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  pk: requiredNumberField('PK wajib diisi'),
  inverter: z.boolean(),
  btu: optionalIntField,
  watt: optionalIntField,
  warranty: z.string().optional(),
  description: z.string().optional(),
  sellPrice: requiredNumberField('Harga jual wajib diisi'),
  active: z.boolean(),
});
```

Ganti `emptyValues` (baris ~90-102):
```ts
const emptyValues: ProductFormValues = {
  name: '',
  brand: '',
  type: '',
  category: '',
  pk: '',
  inverter: false,
  btu: '',
  watt: '',
  warranty: '',
  description: '',
  sellPrice: '',
  active: true,
};
```

Ganti `toFormValues` (baris ~104-118):
```ts
function toFormValues(p: Product): ProductFormValues {
  return {
    name: p.name,
    brand: p.brand ?? '',
    type: p.type ?? '',
    category: p.category ?? '',
    pk: p.pk ?? '',
    inverter: p.inverter,
    btu: p.btu?.toString() ?? '',
    watt: p.watt?.toString() ?? '',
    warranty: p.warranty ?? '',
    description: p.description ?? '',
    sellPrice: p.sellPrice,
    active: p.active,
  };
}
```

Tambah import `CurrencyInput` di bagian import (setelah `import { Input } from '@/components/ui/input';`):
```ts
import { CurrencyInput } from '@/components/ui/currency-input';
```

- [ ] **Step 3: Kirim `sellPrice` di `saveMutation` (create DAN update)**

Ganti `mutationFn` di `saveMutation` (baris ~148-177):
```ts
    mutationFn: async (values: ProductFormValues) => {
      const base = {
        name: values.name.trim(),
        brand: trimmedOrUndefined(values.brand),
        type: trimmedOrUndefined(values.type),
        category: trimmedOrUndefined(values.category),
        pk: Number(values.pk),
        inverter: values.inverter,
        btu: numberOrUndefined(values.btu),
        watt: numberOrUndefined(values.watt),
        warranty: trimmedOrUndefined(values.warranty),
        description: trimmedOrUndefined(values.description),
        // Siklus harga-seragam (2026-09-22) — sellPrice SEKARANG dikirim di
        // create MAUPUN update (dulu sengaja di-skip di update karena
        // harga diatur lewat stock-in per-batch; sekarang Master Data ini
        // satu-satunya tempat atur harga jual produk).
        sellPrice: Number(values.sellPrice),
      };
      if (editing) {
        // Stok TETAP gak dikirim di update — satu-satunya jalur ubah itu
        // StockService.stockIn() (halaman detail produk, klik baris tabel).
        return apiClient.patch<Product>(`/products/${editing.id}`, {
          ...base,
          active: values.active,
        });
      }
      // Produk baru mulai dengan 0 stok (masih perlu stock-in), tapi
      // sellPrice WAJIB udah keisi dari awal.
      return apiClient.post<Product>('/products', base);
    },
```

- [ ] **Step 4: Update pesan sukses create — cuma "isi stok", bukan "stok & harga jual" lagi**

Ganti (baris ~178-187):
```ts
    onSuccess: (product, values) => {
      toast.success(editing ? 'Produk diperbarui.' : 'Produk ditambahkan.');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setDialogOpen(false);
      if (!editing) {
        toast.info(`Klik baris "${values.name}" di tabel buat isi stok pertamanya.`);
      }
    },
```

- [ ] **Step 5: Update deskripsi dialog & tambah field "Harga Jual" ke form**

Ganti `DialogDescription` (baris ~220-224):
```tsx
            <DialogDescription>
              {editing
                ? 'Ubah identitas, spesifikasi & harga jual produk. Stok diatur lewat halaman detail (klik baris di tabel).'
                : 'Isi identitas, spesifikasi & harga jual produk baru. Stok baru bisa diisi setelah produk ini disimpan, lewat halaman detail (klik baris di tabel).'}
            </DialogDescription>
```

Tambah `FormField` baru buat `sellPrice`, taruh persis SETELAH `FormField` `category` (baris ~272-284) dan SEBELUM grid PK/BTU/Watt (baris ~285):
```tsx
              <FormField
                control={form.control}
                name="sellPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Harga Jual</FormLabel>
                    <FormControl>
                      <CurrencyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
```

- [ ] **Step 6: Sederhanakan tampilan harga di tabel — `sellPriceMin`/`sellPriceMax` jadi `sellPrice`**

Ganti header kolom (baris ~428) dari `<TableHead>Stok & Harga Jual</TableHead>` jadi:
```tsx
            <TableHead>Stok</TableHead>
            <TableHead>Harga Jual</TableHead>
```

Ganti isi `<TableCell>` stok (baris ~441-455):
```tsx
              <TableCell>
                {p.stock > 0 ? (
                  <p>{p.stock} unit</p>
                ) : (
                  <Badge variant="warning">Belum ada stok</Badge>
                )}
              </TableCell>
              <TableCell>{formatRupiah(p.sellPrice)}</TableCell>
```

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/master/produk/page.tsx"
git commit -m "feat(fe): Master Data Produk - field Harga Jual seragam"
```

---

### Task 7: Frontend — Halaman Detail Produk (Barang Masuk per-produk)

**Files:**
- Modify: `src/app/(dashboard)/master/produk/[id]/product-detail-client.tsx`

- [ ] **Step 1: Update interface `Product` — tambah `sellPrice`, hapus `sellPriceMin`/`sellPriceMax`**

Ganti (baris ~50-57):
```ts
interface Product {
  id: string;
  name: string;
  brand: string | null;
  stock: number;
  sellPrice: string;
}
```

- [ ] **Step 2: Hapus field `sellPrice` dari `batchInSchema`, empty values & payload**

Ganti (baris ~84-101):
```ts
const batchInSchema = z.object({
  qty: requiredNumberField('Qty wajib diisi').refine(
    (v) => Number.isInteger(Number(v)),
    'Qty produk harus bilangan bulat',
  ),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  supplierName: z.string().optional(),
  note: z.string().optional(),
});
type BatchInValues = z.infer<typeof batchInSchema>;
const batchInEmptyValues: BatchInValues = {
  qty: '',
  buyPrice: '',
  supplierName: '',
  note: '',
};
```

Ganti payload di `batchInMutation.mutationFn` (baris ~122-133) — hapus baris `sellPrice: Number(values.sellPrice),`:
```ts
  const batchInMutation = useMutation({
    mutationFn: (values: BatchInValues & { confirmOverride?: boolean }) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'product',
        refId: productId,
        qty: Number(values.qty),
        buyPrice: Number(values.buyPrice),
        supplierName: trimmedOrUndefined(values.supplierName),
        note: trimmedOrUndefined(values.note),
        confirmOverride: values.confirmOverride,
      }),
```

- [ ] **Step 3: Hapus `FormField` "Harga Jual" dari form Tambah Batch, tampilin `Product.sellPrice` di header**

Ganti grid `buyPrice`/`sellPrice` (baris ~261-288) jadi cuma `buyPrice` sendiri (gak perlu grid-2 lagi):
```tsx
                <FormField
                  control={batchInForm.control}
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
```

Tambah badge Harga Jual di header halaman — ganti blok header (baris ~180-189):
```tsx
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          {product.stock > 0 ? (
            <Badge variant="success">{product.stock} unit</Badge>
          ) : (
            <Badge variant="warning">Belum ada stok</Badge>
          )}
          <Badge variant="secondary">Harga Jual: {formatRupiah(product.sellPrice)}</Badge>
        </div>
        {product.brand && <p className="mt-1 text-sm text-muted-foreground">{product.brand}</p>}
```

- [ ] **Step 4: Hapus kolom "Jual" dari tabel Batch Aktif**

Ganti `CardDescription` (baris ~195-197):
```tsx
            <CardDescription>
              Daftar batch aktif (stok &gt; 0). Tiap batch punya harga modal sendiri — harga jual
              udah seragam (lihat badge di atas), diatur lewat Master Data Produk.
            </CardDescription>
```

Ganti header tabel (baris ~210-217) — hapus `<TableHead>Jual</TableHead>`:
```tsx
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Modal</TableHead>
                      <TableHead>Stok</TableHead>
                    </TableRow>
```

Ganti baris body tabel (baris ~220-231) — hapus `<TableCell>{formatRupiah(b.sellPrice)}</TableCell>`:
```tsx
                    {batchesQuery.data.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="text-muted-foreground">
                          {formatDate(b.createdAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {b.supplierName || '-'}
                        </TableCell>
                        <TableCell>{formatRupiah(b.buyPrice)}</TableCell>
                        <TableCell>{b.stock}</TableCell>
                      </TableRow>
                    ))}
```

(interface `ProductBatch` di baris ~59-66 TETAP boleh punya field `sellPrice: string` — respons API-nya masih ngirim itu apa adanya walau isinya selalu "0", gak perlu diubah di FE karena udah gak ditampilin.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/master/produk/[id]/product-detail-client.tsx"
git commit -m "feat(fe): halaman detail produk - barang masuk gak minta harga jual lagi"
```

---

### Task 8: Frontend — Halaman Barang Masuk (`stock-client.tsx`, Tab Produk)

**Files:**
- Modify: `src/app/(dashboard)/stock/stock-client.tsx`

- [ ] **Step 1: Update interface `Product` — `sellPriceMin`/`sellPriceMax` jadi `sellPrice`**

Ganti (baris ~58-67):
```ts
interface Product {
  id: string;
  name: string;
  brand: string | null;
  stock: number;
  sellPrice: string;
}
```

- [ ] **Step 2: Hapus `sellPrice` dari `productStockInSchema` & empty values**

Ganti (baris ~145-163):
```ts
const productStockInSchema = z.object({
  qty: requiredNumberField('Qty wajib diisi').refine(
    (v) => Number.isInteger(Number(v)),
    'Qty produk harus bilangan bulat',
  ),
  buyPrice: requiredNumberField('Harga modal wajib diisi'),
  supplierName: z.string().optional(),
  note: z.string().optional(),
});
type ProductStockInValues = z.infer<typeof productStockInSchema>;

const productStockInEmptyValues: ProductStockInValues = {
  qty: '',
  buyPrice: '',
  supplierName: '',
  note: '',
};
```

- [ ] **Step 3: Hapus `sellPrice` dari payload mutation**

Ganti `mutationFn` di `stockInMutation` tab Produk (baris ~207-218) — hapus baris `sellPrice: Number(values.sellPrice),`:
```ts
    mutationFn: (values: ProductStockInValues & { confirmOverride?: boolean }) =>
      apiClient.post<StockInResult>('/stock/in', {
        kind: 'product',
        refId: selected!.id,
        qty: Number(values.qty),
        buyPrice: Number(values.buyPrice),
        supplierName: trimmedOrUndefined(values.supplierName),
        note: trimmedOrUndefined(values.note),
        confirmOverride: values.confirmOverride,
      }),
```

- [ ] **Step 4: Update subtitle picker produk — pakai `sellPrice` langsung**

Ganti `renderSubtitle` di `ItemSearchPicker` tab Produk (baris ~262-271):
```tsx
              renderSubtitle={(p) =>
                p.stock > 0
                  ? `Stok: ${p.stock} • ${formatRupiah(p.sellPrice)}`
                  : 'Belum ada batch (stok 0)'
              }
```

- [ ] **Step 5: Tampilin `Product.sellPrice` di card "Tambah Batch Baru", hapus field harga jual dari form**

Ganti `CardHeader` produk terpilih (baris ~285-288) jadi tambah subtitle harga:
```tsx
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{selected.name}</CardTitle>
                  <CardDescription>Harga Jual (seragam): {formatRupiah(selected.sellPrice)}</CardDescription>
                </CardHeader>
```
(pastikan `CardDescription` udah ke-import — sudah ada di import block `@/components/ui/card` baris ~19, tinggal ditambah `CardDescription` ke situ kalau belum: cek baris `import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';` lalu tambahin `CardDescription`.)

Ganti header tabel batch (baris ~299-306) — hapus `<TableHead>Jual</TableHead>`:
```tsx
                        <TableRow>
                          <TableHead>Tanggal</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Modal</TableHead>
                          <TableHead>Stok</TableHead>
                        </TableRow>
```

Ganti body tabel batch (baris ~309-321) — hapus `<TableCell>{formatRupiah(b.sellPrice)}</TableCell>`:
```tsx
                          {batchesQuery.data.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell className="text-muted-foreground">
                                {formatDate(b.createdAt)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {b.supplierName || '-'}
                              </TableCell>
                              <TableCell>{formatRupiah(b.buyPrice)}</TableCell>
                              <TableCell>{b.stock}</TableCell>
                            </TableRow>
                          ))}
```

Hapus `FormField` "Harga Jual" dari form Tambah Batch — ganti grid 2 kolom (baris ~349-376) jadi cuma `buyPrice` sendiri:
```tsx
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
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/stock/stock-client.tsx"
git commit -m "feat(fe): halaman Barang Masuk - tab produk gak minta harga jual lagi"
```

---

### Task 9: Frontend — Halaman POS (Hapus BatchPicker, Harga Jual Editable)

**Files:**
- Modify: `src/app/(dashboard)/pos/page.tsx`

- [ ] **Step 1: Update interface `Product` — `sellPriceMin`/`sellPriceMax` jadi `sellPrice`, hapus interface `ProductBatch`**

Ganti (baris ~61-79):
```ts
interface Product {
  id: string;
  name: string;
  brand: string | null;
  stock: number;
  sellPrice: string;
}
interface Sparepart {
  id: string;
  name: string;
  unit: string;
  sellPrice: string;
  stock: string;
}
```
(interface `ProductBatch` DIHAPUS total — gak ada lagi dialog pemilihan batch.)

- [ ] **Step 2: Update komentar file (baris ~47-59) — hapus penyebutan batch-pick**

Ganti jadi:
```ts
// Item picker (Produk/Sparepart/Jasa) + keranjang di satu halaman, BUKAN dua
// layar terpisah kayak Flutter (bottom sheet -> /pos/checkout) — layar lebar
// punya ruang buat nampilin semuanya sekaligus, jadi kasir gak perlu
// bolak-balik. Alur bisnis & payload checkout tetap sama persis SELAIN hal
// baru dari Siklus harga-seragam (2026-09-22): produk sekarang FIFO otomatis
// lintas batch (gak ada lagi dialog pilih batch) — harga jual default dari
// Product.sellPrice, tapi kasir bisa EDIT manual per baris pas checkout
// (CartLine.unitPrice langsung bisa diubah, dikirim sebagai
// unitPriceOverride). SERVER tetap yang resolve nama/harga final, harga di
// sini cuma pratinjau — kalau kasir gak ngedit apa-apa, harga yang kekirim
// ya harga default itu.
//
// Diskon SENGAJA cuma 1 (level-transaksi, di form ringkasan bawah) — bukan
// per-baris lagi. Backend (CheckoutItemDto.discount) masih nerima diskon
// per-item kalau dikirim, tapi UI ini sekarang gak pernah ngirim itu (selalu
// undefined) biar kasir gak bingung mikirin diskon di 2 tempat beda.
```

- [ ] **Step 3: Sederhanakan `CartLine` — hapus `itemCostId`**

Ganti interface `CartLine` (baris ~122-141):
```ts
interface CartLine {
  kind: CartItemKind;
  refId: string;
  name: string;
  unit: string;
  // Harga jual baris ini — default dari Product.sellPrice (produk) /
  // Sparepart.sellPrice / Service.basePrice pas ditambahin, tapi buat
  // kind='product' BISA diedit manual di keranjang (lihat setUnitPrice) —
  // dikirim ke server sebagai `unitPriceOverride`.
  unitPrice: number;
  qty: number;
  // Diambil dari product.stock/sparepart.stock pas baris ditambah — cuma
  // buat cap tombol "+" di UI (soft guard), validasi beneran tetap di
  // server (StockLockingService).
  availableStock?: number;
  withInstallation: boolean;
  roomLocation: string;
  // Paket instalasi (opsional) buat baris ini — dipakai buat SEMUA unit di
  // baris ini kalau qty > 1 (1 baris = 1 pilihan paket, bukan per-unit).
  packageId?: string;
}
```

- [ ] **Step 4: Sederhanakan `lineMatchKey` — selalu `${kind}:${refId}`**

Ganti (baris ~199-204):
```ts
// Kunci unik per BARIS cart — selalu `${kind}:${refId}` (Siklus
// harga-seragam 2026-09-22: produk gak lagi punya konsep "batch" di
// keranjang, sama kayak lineKey() di PosService backend).
function lineMatchKey(l: { kind: CartItemKind; refId: string }): string {
  return `${l.kind}:${l.refId}`;
}
```

- [ ] **Step 5: Hapus state `batchPickerProduct` & query `batchesQuery`, tambah `setUnitPrice`**

Di dalam `PosPage()`, hapus baris (~239-241):
```ts
  // Produk yang lagi dipilih buat nentuin batch mana yang mau ditambah ke
  // keranjang — dialog BatchPicker di bawah muncul selama ini gak null.
  const [batchPickerProduct, setBatchPickerProduct] = React.useState<Product | null>(null);
```

Hapus query `batchesQuery` (~286-290):
```ts
  const batchesQuery = useQuery({
    queryKey: ['product-batches', batchPickerProduct?.id],
    queryFn: () => apiClient.get<ProductBatch[]>(`/products/${batchPickerProduct!.id}/batches`),
    enabled: !!batchPickerProduct,
  });
```

Ganti fungsi `addProductBatchLine` (~304-320) jadi `addProductLine` — langsung nambah ke cart pakai `Product.sellPrice` (gak buka dialog lagi):
```ts
  function addProductLine(p: Product) {
    addLine({
      kind: 'product',
      refId: p.id,
      name: p.name,
      unit: 'unit',
      unitPrice: Number(p.sellPrice),
      qty: 1,
      availableStock: p.stock,
      withInstallation: false,
      roomLocation: '',
      packageId: undefined,
    });
  }

  // Ubah harga jual baris produk secara manual (kasir bisa nego harga di
  // kasir) — dikirim ke server sebagai unitPriceOverride pas checkout.
  function setUnitPrice(index: number, value: number) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, unitPrice: value } : l)));
  }
```

- [ ] **Step 6: Update `checkoutMutation` payload — hapus `itemCostId`, tambah `unitPriceOverride`**

Ganti pembangunan `items` di dalam `mutationFn` (baris ~468-475):
```ts
        items: lines.map((l) => ({
          kind: l.kind,
          refId: l.refId,
          qty: l.qty,
          // Diskon per-item SENGAJA gak pernah dikirim dari sini lagi —
          // cuma ada 1 diskon (level-transaksi, `discount` di bawah).
          //
          // unitPriceOverride SELALU dikirim buat baris produk — line.unitPrice
          // udah langsung jadi "harga efektif" begitu ditambah ke keranjang
          // (default Product.sellPrice, bisa diedit manual lewat setUnitPrice).
          // Kalau kasir gak pernah nyentuh, nilainya ya sama persis kayak
          // default itu — server tetap terima sebagai override eksplisit,
          // gak masalah (hasilnya identik).
          unitPriceOverride: l.kind === 'product' ? l.unitPrice : undefined,
        })),
```

- [ ] **Step 7: Update `productCards` — `onAdd` langsung panggil `addProductLine`, harga dari `sellPrice`**

Ganti (baris ~553-565):
```ts
  const productCards = filteredProducts.map((p) => {
    const outOfStock = p.stock <= 0;
    return {
      key: `product-${p.id}`,
      name: p.name,
      subtitle: outOfStock
        ? 'Belum ada stok — input dulu lewat Barang Masuk'
        : `Stok ${p.stock}${p.brand ? ` • ${p.brand}` : ''}`,
      price: outOfStock ? undefined : p.sellPrice,
      disabled: outOfStock,
      onAdd: () => addProductLine(p),
    };
  });
```

- [ ] **Step 8: Ganti tampilan harga di baris keranjang — editable buat produk**

Ganti blok nama+harga di dalam `lines.map` (baris ~712-717):
```tsx
                        <div>
                          <p className="text-sm font-medium">{line.name}</p>
                          {line.kind === 'product' ? (
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Harga:</span>
                              <CurrencyInput
                                className="h-7 w-28 text-xs"
                                value={String(line.unitPrice)}
                                onChange={(v) => setUnitPrice(index, Number(v) || 0)}
                              />
                              <span className="text-xs text-muted-foreground">/ {line.unit}</span>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {formatRupiah(line.unitPrice)} / {line.unit}
                            </p>
                          )}
                        </div>
```

- [ ] **Step 9: Hapus dialog BatchPicker**

Hapus SELURUH blok `<Dialog open={!!batchPickerProduct} ...>` sampai `</Dialog>` penutupnya (baris ~1031-1070 — dari `<Dialog\n open={!!batchPickerProduct}` sampai `</Dialog>` tepat sebelum `<Dialog open={!!pendingWarnings}...`).

- [ ] **Step 10: Update key di dialog warning — `w.itemCostId` udah selalu null, pakai index aja**

Ganti (baris ~1082):
```tsx
            {pendingWarnings?.map((w, i) => (
              <div key={`${w.refId}-${i}`} className="rounded-md border p-3 text-sm">
```

- [ ] **Step 11: Verifikasi build**

Run: `npx tsc --noEmit` (dari root `epos-frontend-web`)
Expected: gak ada error TypeScript — pastikan gak ada sisa referensi ke `batchPickerProduct`, `ProductBatch`, `addProductBatchLine`, `sellPriceMin`, `sellPriceMax`, atau `itemCostId` di file ini maupun di `master/produk/page.tsx`, `master/produk/[id]/product-detail-client.tsx`, `stock/stock-client.tsx`.

- [ ] **Step 12: Commit**

```bash
git add "src/app/(dashboard)/pos/page.tsx"
git commit -m "feat(fe): POS - hapus dialog pilih batch, harga jual editable per baris"
```

---

### Task 10: Verifikasi Akhir (Manual, Karena Belum Ada Test E2E Checkout)

Codebase ini belum punya test integrasi/e2e buat `PosService.checkout` (butuh DB beneran, di luar scope Jest unit test yang ada). Verifikasi manual berikut WAJIB dijalanin sebelum nganggep Point 1 selesai:

- [ ] **Step 1: Build backend**

Run: `npm run build` (di `epos-backend`)
Expected: sukses, 0 error TypeScript.

- [ ] **Step 2: Jalanin semua unit test backend**

Run: `npx jest`
Expected: semua test PASS, termasuk `pos-calc.util.spec.ts`, `below-cost.util.spec.ts`, `stock-locking.service.spec.ts` yang baru.

- [ ] **Step 3: Smoke test manual — alur penuh**

Di environment dev (backend `npm run start:dev` + frontend `npm run dev`):
1. Master Data > Produk > Tambah Produk baru, isi Harga Jual (misal 3.200.000). Simpan.
2. Klik baris produk itu > Tambah Batch Baru: qty 5, Harga Modal 2.900.000, Supplier "Toko A". Simpan — HARUS sukses tanpa warning (modal < jual).
3. Tambah batch KEDUA: qty 3, Harga Modal 3.100.000, Supplier "Toko B". Simpan — HARUS sukses tanpa warning (masih di bawah 3.200.000).
4. Buka POS, cari produk itu, klik buat nambah ke keranjang — HARUS langsung masuk keranjang (BUKAN nampilin dialog pilih batch), harga default 3.200.000, field harga BISA diketik ulang.
5. Set qty jadi 6 (nembus ke batch kedua — 5 dari batch Toko A + 1 dari batch Toko B). Checkout.
6. Cek halaman detail invoice hasil checkout — `buyPriceSnapshot` di baris produk itu HARUS 3.100.000 (MAX dari 2 batch, bukan 2.900.000).
7. Cek halaman Barang Masuk / detail produk — batch Toko A HARUS sisa 0 stok, batch Toko B HARUS sisa 2 stok (5+3 -6 = 2, dari batch kedua).
8. Ulangi checkout produk yang sama, tapi kali ini EDIT harga jual di keranjang jadi di bawah 3.100.000 (misal 3.000.000) — checkout HARUS munculin dialog konfirmasi "di bawah modal" sebelum lanjut.

Expected: semua 8 langkah di atas sesuai deskripsi. Kalau ada yang meleset, JANGAN lanjut ke Point 3 — debug dulu di sini.
