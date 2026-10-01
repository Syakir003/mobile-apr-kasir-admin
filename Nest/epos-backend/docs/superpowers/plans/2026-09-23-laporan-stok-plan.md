# Laporan Stok (Audit/Opname) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Endpoint `GET /reports/stock-movements` + halaman frontend "Laporan Stok" yang nampilin Stok Awal/Masuk/Keluar/Sisa/Value per item (produk & sparepart) dalam rentang tanggal, dengan baris gabungan khusus buat AC Indoor/Outdoor berpasangan, plus tombol cetak/export PDF (browser print, reuse pola invoice).

**Architecture:** Murni fitur READ/laporan — TIDAK ada migrasi skema baru (semua kolom yang dibutuhkan, `StockMovement.pairGroupId` dari Point 2 dan `ItemCost.stock` Decimal dari Point 3, sudah ada). Tambah 1 method baru `ReportsService.stockMovements()` (2 helper privat: query produk & sparepart terpisah, raw SQL, pola sama kayak `sales()`/`profitLoss()` yang udah ada) + 1 pure function `buildStockReportRow()` yang testable tanpa DB buat gabungin angka2 hasil query jadi 1 baris laporan (termasuk logic baris "Unit [pasangan]"). Endpoint baru nempel di `ReportsController`/`ReportsModule` yang UDAH ADA (gak bikin module baru). Frontend nambah tab "Stok" di halaman Laporan yang udah ada + 1 halaman print baru (pola sama kayak `invoices/[id]/print`).

**Tech Stack:** NestJS + Prisma raw SQL (`$queryRaw`) — pola konsisten sama 3 method lain di `ReportsService`. Next.js App Router + TanStack Query + shadcn/ui Table/Tabs (frontend, pola sama kayak `laporan/page.tsx` yang udah ada).

---

## Konteks penting buat semua task

- Repo backend: `epos-backend` (NestJS + Prisma + PostgreSQL). Repo frontend: `epos-frontend-web` (Next.js App Router).
- Module `src/reports/` UDAH ADA (3 endpoint: `/reports/sales`, `/reports/service`, `/reports/profit-loss`). Task-task di plan ini NAMBAH ke module itu, BUKAN bikin module baru.
- `ReportsController` sudah dijaga `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin')` di level CLASS — endpoint baru otomatis ikut ter-guard, gak perlu decorator tambahan.
- Util `parseDateRange(from, to)` di `src/reports/reports.util.ts` SUDAH ADA dan WAJIB dipakai ulang (bukan bikin parsing tanggal baru) — dia udah nangani WIB-awareness + validasi format.
- Kolom yang dipakai laporan ini SEMUA UDAH ADA di skema (gak ada migrasi di plan ini):
  - `stock_movements.qty_change` (Decimal, boleh negatif=keluar/positif=masuk), `.item_kind` ('product'|'sparepart'), `.ref_id`, `.pair_group_id` (nullable, diisi Point 2 buat 2 baris Indoor+Outdoor dari SATU aksi "Unit Lengkap"), `.created_at`.
  - `item_costs.stock` (Decimal, sisa per-batch — buat produk & sparepart batch-tracked), `.buy_price`, `.kind`, `.ref_id`.
  - `products.paired_product_id` (nullable — Indoor→Outdoor, Point 2).
  - `spareparts.batch_tracked` (Boolean), `spareparts.stock` (Decimal, mirror resmi buat sparepart FLAT — lihat komentar di schema.prisma).
  - `invoice_items.buy_price_snapshot`, `.line_total`, `.qty`, `.kind`, `.ref_id`.
- **Sisa Stok & Modal Tersisa itung dari `item_costs`/`spareparts.stock` (kondisi SAAT INI, bukan hasil kalkulasi movement)** — Stok Awal/Masuk/Keluar itung dari `stock_movements` (range tanggal). Dua sumber ini SENGAJA independen (spec Point 4).
- **Klasifikasi Masuk vs Keluar pakai TANDA `qty_change`** (positif=masuk, negatif=keluar), BUKAN string `reason` — ini pola paling robust karena gak perlu update kalau ada `reason` baru ditambah di masa depan. Konsisten sama komentar di schema: `qtyChange // boleh negatif (keluar) / positif (masuk)`.
- Baris "Unit [nama pasangan]": HANYA muncul nempel di baris produk Indoor (`paired_product_id` keisi), berisi ringkasan movement yang `pair_group_id`-nya gak null, **diambil dari refId sisi Indoor doang** (qty Outdoor di aksi yang sama SELALU sama, jangan dijumlah dobel — lihat komentar `StockMovement.pairGroupId` di schema.prisma). Sisa Unit = `MIN(sisa Indoor, sisa Outdoor)` itung on-the-fly.
- Format angka: semua angka Decimal dari Prisma raw query balik sebagai STRING lewat `$queryRaw` (gotcha yang sama kayak Point 3) — WAJIB `Number(...)` sebelum dipakai. `buildStockReportRow` (Task 1) udah nanganin ini lewat helper `n()`.

---

### Task 1: Pure function `buildStockReportRow` (gabungin hasil query jadi 1 baris laporan)

**Files:**
- Create: `src/reports/stock-report-row.util.ts`
- Test: `src/reports/stock-report-row.util.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/reports/stock-report-row.util.spec.ts
import { buildStockReportRow } from './stock-report-row.util';

describe('buildStockReportRow (Point 4 - Laporan Stok)', () => {
  const baseItem = {
    itemKind: 'product' as const,
    refId: 'p1',
    name: 'AC Split 1PK Indoor',
    unit: 'unit',
    category: 'AC',
  };

  it('semua angka default 0 kalau agg kosong/null', () => {
    const row = buildStockReportRow(baseItem, {});
    expect(row).toMatchObject({
      itemKind: 'product',
      refId: 'p1',
      name: 'AC Split 1PK Indoor',
      unit: 'unit',
      category: 'AC',
      stokAwal: 0,
      stokMasuk: 0,
      stokKeluar: 0,
      sisaStok: 0,
      modalTersisa: 0,
      omzetTerjual: 0,
      untungTerjual: 0,
    });
    expect(row.unitGabungan).toBeUndefined();
  });

  it('parse angka dari string (gotcha Decimal via $queryRaw) & itung untungTerjual = omzet - cogs', () => {
    const row = buildStockReportRow(baseItem, {
      opening: '5',
      masuk: '10',
      keluar: '3',
      sisa: '12',
      modal: '1200000',
      omzet: '3000000',
      cogs: '2000000',
    });
    expect(row.stokAwal).toBe(5);
    expect(row.stokMasuk).toBe(10);
    expect(row.stokKeluar).toBe(3);
    expect(row.sisaStok).toBe(12);
    expect(row.modalTersisa).toBe(1200000);
    expect(row.omzetTerjual).toBe(3000000);
    expect(row.untungTerjual).toBe(1000000);
  });

  it('nambahin unitGabungan kalau ada pairedItem, sisaUnit = MIN(sisa indoor, sisa outdoor)', () => {
    const row = buildStockReportRow(
      baseItem,
      { sisa: '4' },
      {
        pairedItem: { itemKind: 'product', refId: 'p2', name: 'AC Split 1PK Outdoor', unit: 'unit', category: 'AC' },
        pairedSisa: 7,
        unitAgg: { masuk: '2', keluar: '1' },
      },
    );
    expect(row.unitGabungan).toEqual({
      namaPasangan: 'AC Split 1PK Outdoor',
      stokMasuk: 2,
      stokKeluar: 1,
      sisaStok: 4, // MIN(4, 7)
    });
  });

  it('unitAgg kosong (belum pernah ada aksi Unit Lengkap) tetap kebentuk unitGabungan dgn angka 0', () => {
    const row = buildStockReportRow(
      baseItem,
      { sisa: '9' },
      {
        pairedItem: { itemKind: 'product', refId: 'p2', name: 'AC Split 1PK Outdoor', unit: 'unit', category: 'AC' },
        pairedSisa: 2,
      },
    );
    expect(row.unitGabungan).toEqual({
      namaPasangan: 'AC Split 1PK Outdoor',
      stokMasuk: 0,
      stokKeluar: 0,
      sisaStok: 2, // MIN(9, 2)
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/reports/stock-report-row.util.spec.ts`
Expected: FAIL — `Cannot find module './stock-report-row.util'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/reports/stock-report-row.util.ts

/** Satu item katalog (produk ATAU sparepart) sebelum digabung sama angka
 * agregatnya. `unit`: 'unit' buat product (konstan, sama kayak cart line
 * POS), `Sparepart.unit` buat sparepart. */
export interface StockReportCatalogItem {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  category: string | null;
}

/** Angka mentah hasil query — semua opsional/null (item bisa gak punya
 * baris sama sekali di salah satu sumber) & boleh berupa STRING (gotcha
 * Decimal lewat `$queryRaw`, lihat komentar Point 3 di ItemCost.stock). */
export interface StockReportAgg {
  opening?: number | string | null;
  masuk?: number | string | null;
  keluar?: number | string | null;
  sisa?: number | string | null;
  modal?: number | string | null;
  omzet?: number | string | null;
  cogs?: number | string | null;
}

export interface StockReportUnitAgg {
  masuk?: number | string | null;
  keluar?: number | string | null;
}

export interface StockReportRow {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  category: string | null;
  stokAwal: number;
  stokMasuk: number;
  stokKeluar: number;
  sisaStok: number;
  modalTersisa: number;
  omzetTerjual: number;
  untungTerjual: number;
  // Cuma keisi kalau `item` ini sisi Indoor (products.paired_product_id
  // keisi) — Point 4, spec "3 baris terpisah": baris Indoor (row ini
  // sendiri), baris Outdoor (row terpisah lain di array `items`, gak
  // disentuh di sini), + ringkasan gabungan ini yang FE tampilin menjorok
  // di bawah baris Indoor.
  unitGabungan?: {
    namaPasangan: string;
    stokMasuk: number;
    stokKeluar: number;
    sisaStok: number;
  };
}

function n(v: number | string | null | undefined): number {
  return v == null ? 0 : Number(v);
}

/** Gabungin 1 baris katalog + angka2 agregat (opening/masuk/keluar dari
 * stock_movements, sisa/modal dari item_costs atau spareparts.stock,
 * omzet/cogs dari invoice_items) jadi 1 `StockReportRow` siap-tampil. Kalau
 * `opts.pairedItem` dikasih (produk ini sisi Indoor), nambah `unitGabungan`
 * — `sisaStok` di situ SELALU `MIN(sisa produk ini, opts.pairedSisa)`,
 * itung on-the-fly (bukan disimpan), sesuai spec Point 4. */
export function buildStockReportRow(
  item: StockReportCatalogItem,
  agg: StockReportAgg,
  opts?: { pairedItem: StockReportCatalogItem; pairedSisa: number; unitAgg?: StockReportUnitAgg },
): StockReportRow {
  const omzet = n(agg.omzet);
  const row: StockReportRow = {
    itemKind: item.itemKind,
    refId: item.refId,
    name: item.name,
    unit: item.unit,
    category: item.category,
    stokAwal: n(agg.opening),
    stokMasuk: n(agg.masuk),
    stokKeluar: n(agg.keluar),
    sisaStok: n(agg.sisa),
    modalTersisa: n(agg.modal),
    omzetTerjual: omzet,
    untungTerjual: omzet - n(agg.cogs),
  };

  if (opts) {
    row.unitGabungan = {
      namaPasangan: opts.pairedItem.name,
      stokMasuk: n(opts.unitAgg?.masuk),
      stokKeluar: n(opts.unitAgg?.keluar),
      sisaStok: Math.min(n(agg.sisa), opts.pairedSisa),
    };
  }

  return row;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/reports/stock-report-row.util.spec.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add src/reports/stock-report-row.util.ts src/reports/stock-report-row.util.spec.ts
git commit -m "feat(reports): pure function buildStockReportRow buat Laporan Stok (Point 4)"
```

---

### Task 2: DTO `StockMovementsQueryDto`

**Files:**
- Create: `src/reports/dto/stock-movements-query.dto.ts`
- Test: `src/reports/dto/stock-movements-query.dto.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/reports/dto/stock-movements-query.dto.spec.ts
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StockMovementsQueryDto } from './stock-movements-query.dto';

describe('StockMovementsQueryDto (Point 4)', () => {
  it('valid cuma from/to (kind/refId/category opsional)', async () => {
    const dto = plainToInstance(StockMovementsQueryDto, { from: '2026-09-01', to: '2026-09-23' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('valid dgn semua filter opsional keisi', async () => {
    const dto = plainToInstance(StockMovementsQueryDto, {
      from: '2026-09-01',
      to: '2026-09-23',
      kind: 'sparepart',
      refId: 'sp-1',
      category: 'Pipa',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('kind di luar product/sparepart ditolak', async () => {
    const dto = plainToInstance(StockMovementsQueryDto, {
      from: '2026-09-01',
      to: '2026-09-23',
      kind: 'jasa',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('from/to wajib', async () => {
    const dto = plainToInstance(StockMovementsQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/reports/dto/stock-movements-query.dto.spec.ts`
Expected: FAIL — `Cannot find module './stock-movements-query.dto'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/reports/dto/stock-movements-query.dto.ts
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

/** Query `GET /reports/stock-movements` (Point 4) — `from`/`to` WAJIB, sama
 * format & semantik (WIB-aware) kayak `DateRangeDto` yang dipakai 3 endpoint
 * reports lain (lihat `parseDateRange` di reports.util.ts). Filter item
 * SEMUA opsional — kosong = tampilin semua produk+sparepart aktif. */
export class StockMovementsQueryDto {
  @IsISO8601() from: string;
  @IsISO8601() to: string;

  @IsOptional() @IsIn(['product', 'sparepart']) kind?: 'product' | 'sparepart';
  @IsOptional() @IsString() refId?: string;
  @IsOptional() @IsString() category?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/reports/dto/stock-movements-query.dto.spec.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add src/reports/dto/stock-movements-query.dto.ts src/reports/dto/stock-movements-query.dto.spec.ts
git commit -m "feat(reports): StockMovementsQueryDto buat Laporan Stok (Point 4)"
```

---

### Task 3: `ReportsService.stockMovements()` + 2 helper privat (query produk & sparepart)

**Files:**
- Modify: `src/reports/reports.service.ts`

Task ini murni nambah method baru ke class yang udah ada — TIDAK ngubah `sales()`/`service()`/`profitLoss()`. Gak ada test unit baru di sini (raw SQL gak bisa ditest tanpa DB beneran — logic yang testable udah diekstrak ke `buildStockReportRow`, Task 1). Verifikasi lewat trace manual + smoke test manual pas jalan di device asli (dicatat di section "Verifikasi akhir" di bawah).

- [ ] **Step 1: Tambah import di atas `reports.service.ts`**

```typescript
import { buildStockReportRow, StockReportRow, StockReportCatalogItem } from './stock-report-row.util';
```

- [ ] **Step 2: Tambah 3 method baru ke `ReportsService`** (taruh di bawah `profitLoss()`, sebelum penutup class `}`)

```typescript
  /**
   * Point 4 (2026-09-23) — Laporan Stok/Opname. Gabungan 2 query terpisah
   * (produk & sparepart, masing2 helper privat di bawah) — DIPISAH (bukan 1
   * query UNION raksasa) karena beda banget sumber "Sisa Stok"-nya (produk
   * SELALU dari item_costs agregat; sparepart tergantung `batchTracked`,
   * lihat komentar di `sparepartStockReport`). `filter.kind` nentuin query
   * mana yang jalan (kosong = jalanin dua2nya).
   */
  async stockMovements(
    start: Date,
    end: Date,
    filter: { kind?: string; refId?: string; category?: string },
  ): Promise<{
    items: StockReportRow[];
    ringkasan: { totalModalTersisa: number; totalOmzetTerjual: number; totalUntungTerjual: number };
  }> {
    const items: StockReportRow[] = [];

    if (!filter.kind || filter.kind === 'product') {
      items.push(...(await this.productStockReport(start, end, filter)));
    }
    if (!filter.kind || filter.kind === 'sparepart') {
      items.push(...(await this.sparepartStockReport(start, end, filter)));
    }

    const ringkasan = items.reduce(
      (acc, row) => ({
        totalModalTersisa: acc.totalModalTersisa + row.modalTersisa,
        totalOmzetTerjual: acc.totalOmzetTerjual + row.omzetTerjual,
        totalUntungTerjual: acc.totalUntungTerjual + row.untungTerjual,
      }),
      { totalModalTersisa: 0, totalOmzetTerjual: 0, totalUntungTerjual: 0 },
    );

    return { items, ringkasan };
  }

  /**
   * Satu baris per Product AKTIF. Produk sisi Indoor (`pairedProductId`
   * keisi, Point 2) dapet tambahan `unitGabungan` dari `buildStockReportRow`
   * — nama pasangan diambil dari query `pairInfoRows` yang GAK ikut kena
   * filter `refId`/`category` (biar tetep kebaca bener walau lagi difilter
   * kategori yang beda dari pasangannya).
   */
  private async productStockReport(
    start: Date,
    end: Date,
    filter: { refId?: string; category?: string },
  ): Promise<StockReportRow[]> {
    const catalog = await this.prisma.$queryRaw<
      { id: string; name: string; category: string | null; paired_product_id: string | null }[]
    >`
      SELECT id, name, category, paired_product_id
      FROM products
      WHERE active = true
        AND (${filter.refId ?? null}::text IS NULL OR id = ${filter.refId ?? null})
        AND (${filter.category ?? null}::text IS NULL OR category = ${filter.category ?? null})
      ORDER BY name ASC
    `;
    if (catalog.length === 0) return [];

    const pairInfoRows = await this.prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM products WHERE active = true
    `;
    const pairInfoMap = new Map(pairInfoRows.map((r) => [r.id, r.name]));

    const movementRows = await this.prisma.$queryRaw<
      { ref_id: string; opening: string | null; masuk: string | null; keluar: string | null }[]
    >`
      SELECT ref_id,
        SUM(qty_change) FILTER (WHERE created_at < ${start}) AS opening,
        SUM(qty_change) FILTER (WHERE created_at BETWEEN ${start} AND ${end} AND qty_change > 0) AS masuk,
        ABS(SUM(qty_change) FILTER (WHERE created_at BETWEEN ${start} AND ${end} AND qty_change < 0)) AS keluar
      FROM stock_movements
      WHERE item_kind = 'product' AND created_at <= ${end}
      GROUP BY ref_id
    `;
    const movementMap = new Map(movementRows.map((r) => [r.ref_id, r]));

    const currentRows = await this.prisma.$queryRaw<{ ref_id: string; sisa: string; modal: string }[]>`
      SELECT ref_id, SUM(stock) AS sisa, SUM(stock * buy_price) AS modal
      FROM item_costs
      WHERE kind = 'product' AND stock > 0
      GROUP BY ref_id
    `;
    const currentMap = new Map(currentRows.map((r) => [r.ref_id, r]));

    const salesRows = await this.prisma.$queryRaw<{ ref_id: string; omzet: string; cogs: string }[]>`
      SELECT ii.ref_id,
        SUM(ii.line_total) AS omzet,
        SUM(ii.qty * COALESCE(ii.buy_price_snapshot, ic.buy_price, 0)) AS cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN (
        SELECT ref_id, AVG(buy_price) AS buy_price FROM item_costs
        WHERE kind = 'product' AND stock > 0 GROUP BY ref_id
      ) ic ON ic.ref_id = ii.ref_id
      WHERE ii.kind = 'product' AND i.created_at BETWEEN ${start} AND ${end}
      GROUP BY ii.ref_id
    `;
    const salesMap = new Map(salesRows.map((r) => [r.ref_id, r]));

    // Movement ber-pairGroupId dikunci di refId SISI INDOOR doang — lihat
    // komentar `StockMovement.pairGroupId` di schema.prisma (qty Outdoor di
    // aksi yang sama selalu sama, jangan dijumlah dobel).
    const unitRows = await this.prisma.$queryRaw<{ ref_id: string; masuk: string | null; keluar: string | null }[]>`
      SELECT ref_id,
        SUM(qty_change) FILTER (WHERE qty_change > 0) AS masuk,
        ABS(SUM(qty_change) FILTER (WHERE qty_change < 0)) AS keluar
      FROM stock_movements
      WHERE item_kind = 'product' AND pair_group_id IS NOT NULL
        AND created_at BETWEEN ${start} AND ${end}
      GROUP BY ref_id
    `;
    const unitMap = new Map(unitRows.map((r) => [r.ref_id, r]));

    return catalog.map((c) => {
      const agg = movementMap.get(c.id);
      const cur = currentMap.get(c.id);
      const sales = salesMap.get(c.id);
      const item: StockReportCatalogItem = {
        itemKind: 'product',
        refId: c.id,
        name: c.name,
        unit: 'unit',
        category: c.category,
      };

      const opts = c.paired_product_id
        ? {
            pairedItem: {
              itemKind: 'product' as const,
              refId: c.paired_product_id,
              name: pairInfoMap.get(c.paired_product_id) ?? '(produk pasangan tidak aktif)',
              unit: 'unit',
              category: null,
            },
            pairedSisa: Number(currentMap.get(c.paired_product_id)?.sisa ?? 0),
            unitAgg: unitMap.get(c.id),
          }
        : undefined;

      return buildStockReportRow(
        item,
        {
          opening: agg?.opening,
          masuk: agg?.masuk,
          keluar: agg?.keluar,
          sisa: cur?.sisa,
          modal: cur?.modal,
          omzet: sales?.omzet,
          cogs: sales?.cogs,
        },
        opts,
      );
    });
  }

  /**
   * Satu baris per Sparepart AKTIF. `batchTracked` nentuin sumber Sisa
   * Stok/Modal Tersisa (lihat komentar `Sparepart.batchTracked` &
   * `ItemCost.stock` di schema.prisma): batch-tracked pakai agregat
   * `item_costs` (stock>0) sama kayak produk; FLAT pakai `spareparts.stock`
   * (mirror resmi) dikali RATA-RATA `buy_price` SEMUA baris `item_costs`
   * sparepart itu (field `stock`-nya gak dipakai/selalu 0 buat flat, jadi
   * gak bisa difilter stock>0 — pola AVG ini SAMA kayak fallback HPP di
   * `ReportsService.profitLoss()`).
   */
  private async sparepartStockReport(
    start: Date,
    end: Date,
    filter: { refId?: string; category?: string },
  ): Promise<StockReportRow[]> {
    const catalog = await this.prisma.$queryRaw<
      { id: string; name: string; category: string | null; unit: string; stock: string; batch_tracked: boolean }[]
    >`
      SELECT id, name, category, unit, stock, batch_tracked
      FROM spareparts
      WHERE active = true
        AND (${filter.refId ?? null}::text IS NULL OR id = ${filter.refId ?? null})
        AND (${filter.category ?? null}::text IS NULL OR category = ${filter.category ?? null})
      ORDER BY name ASC
    `;
    if (catalog.length === 0) return [];

    const movementRows = await this.prisma.$queryRaw<
      { ref_id: string; opening: string | null; masuk: string | null; keluar: string | null }[]
    >`
      SELECT ref_id,
        SUM(qty_change) FILTER (WHERE created_at < ${start}) AS opening,
        SUM(qty_change) FILTER (WHERE created_at BETWEEN ${start} AND ${end} AND qty_change > 0) AS masuk,
        ABS(SUM(qty_change) FILTER (WHERE created_at BETWEEN ${start} AND ${end} AND qty_change < 0)) AS keluar
      FROM stock_movements
      WHERE item_kind = 'sparepart' AND created_at <= ${end}
      GROUP BY ref_id
    `;
    const movementMap = new Map(movementRows.map((r) => [r.ref_id, r]));

    const batchAggRows = await this.prisma.$queryRaw<{ ref_id: string; sisa: string; modal: string }[]>`
      SELECT ref_id, SUM(stock) AS sisa, SUM(stock * buy_price) AS modal
      FROM item_costs
      WHERE kind = 'sparepart' AND stock > 0
      GROUP BY ref_id
    `;
    const batchAggMap = new Map(batchAggRows.map((r) => [r.ref_id, r]));

    const avgPriceRows = await this.prisma.$queryRaw<{ ref_id: string; avg_price: string }[]>`
      SELECT ref_id, AVG(buy_price) AS avg_price
      FROM item_costs
      WHERE kind = 'sparepart'
      GROUP BY ref_id
    `;
    const avgPriceMap = new Map(avgPriceRows.map((r) => [r.ref_id, r]));

    const salesRows = await this.prisma.$queryRaw<{ ref_id: string; omzet: string; cogs: string }[]>`
      SELECT ii.ref_id,
        SUM(ii.line_total) AS omzet,
        SUM(ii.qty * COALESCE(ii.buy_price_snapshot, ic.buy_price, 0)) AS cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN (
        SELECT ref_id, AVG(buy_price) AS buy_price FROM item_costs
        WHERE kind = 'sparepart' GROUP BY ref_id
      ) ic ON ic.ref_id = ii.ref_id
      WHERE ii.kind = 'sparepart' AND i.created_at BETWEEN ${start} AND ${end}
      GROUP BY ii.ref_id
    `;
    const salesMap = new Map(salesRows.map((r) => [r.ref_id, r]));

    return catalog.map((c) => {
      const agg = movementMap.get(c.id);
      const sales = salesMap.get(c.id);
      const sisa = c.batch_tracked ? Number(batchAggMap.get(c.id)?.sisa ?? 0) : Number(c.stock);
      const modal = c.batch_tracked
        ? Number(batchAggMap.get(c.id)?.modal ?? 0)
        : Number(c.stock) * Number(avgPriceMap.get(c.id)?.avg_price ?? 0);

      return buildStockReportRow(
        { itemKind: 'sparepart', refId: c.id, name: c.name, unit: c.unit, category: c.category },
        {
          opening: agg?.opening,
          masuk: agg?.masuk,
          keluar: agg?.keluar,
          sisa,
          modal,
          omzet: sales?.omzet,
          cogs: sales?.cogs,
        },
      );
    });
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/reports/reports.service.ts
git commit -m "feat(reports): ReportsService.stockMovements - Laporan Stok per item (Point 4)"
```

---

### Task 4: `ReportsController` — endpoint `GET /reports/stock-movements`

**Files:**
- Modify: `src/reports/reports.controller.ts`

- [ ] **Step 1: Tambah import DTO**

```typescript
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';
```

- [ ] **Step 2: Tambah endpoint baru** (taruh di bawah `profitLoss()`, sebelum penutup class `}`)

```typescript
  @Get('stock-movements')
  stockMovements(@Query() query: StockMovementsQueryDto) {
    const { start, end } = parseDateRange(query.from, query.to);
    return this.reports.stockMovements(start, end, {
      kind: query.kind,
      refId: query.refId,
      category: query.category,
    });
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/reports/reports.controller.ts
git commit -m "feat(reports): endpoint GET /reports/stock-movements (Point 4)"
```

---

### Task 5: Frontend — tab "Stok" di halaman Laporan

**Files:**
- Modify: `src/app/(dashboard)/laporan/page.tsx`

Pola ngikutin 3 tab yang udah ada di file ini (`penjualan`/`servis`/`laba-rugi`) — reuse `from`/`to`/`rangeValid` state yang udah ada, TabsList `grid-cols-3` jadi `grid-cols-4`.

- [ ] **Step 1: Tambah interface response di bawah `ProfitLossReport`**

```typescript
interface StockReportRow {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  category: string | null;
  stokAwal: number;
  stokMasuk: number;
  stokKeluar: number;
  sisaStok: number;
  modalTersisa: number;
  omzetTerjual: number;
  untungTerjual: number;
  unitGabungan?: {
    namaPasangan: string;
    stokMasuk: number;
    stokKeluar: number;
    sisaStok: number;
  };
}

interface StockReport {
  items: StockReportRow[];
  ringkasan: { totalModalTersisa: number; totalOmzetTerjual: number; totalUntungTerjual: number };
}
```

- [ ] **Step 2: Tambah state filter kind + query, taruh di bawah deklarasi `profitLossQuery`**

```typescript
  const [stokKind, setStokKind] = React.useState<'all' | 'product' | 'sparepart'>('all');

  const stockQuery = useQuery({
    queryKey: ['reports', 'stock-movements', from, to, stokKind],
    queryFn: () =>
      apiClient.get<StockReport>(
        `/reports/stock-movements?from=${from}&to=${to}${stokKind !== 'all' ? `&kind=${stokKind}` : ''}`,
      ),
    enabled: tab === 'stok' && rangeValid,
  });
```

- [ ] **Step 3: Tambah import `Select` + `Link`/`Printer` di bagian import paling atas**

```typescript
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

- [ ] **Step 4: Ubah `TabsList` jadi 4 kolom + tambah trigger "Stok"**

Cari baris:
```typescript
        <TabsList className="grid w-full grid-cols-3 sm:w-fit">
          <TabsTrigger value="penjualan">Penjualan</TabsTrigger>
          <TabsTrigger value="servis">Servis</TabsTrigger>
          <TabsTrigger value="laba-rugi">Laba-Rugi</TabsTrigger>
        </TabsList>
```
Ganti jadi:
```typescript
        <TabsList className="grid w-full grid-cols-4 sm:w-fit">
          <TabsTrigger value="penjualan">Penjualan</TabsTrigger>
          <TabsTrigger value="servis">Servis</TabsTrigger>
          <TabsTrigger value="laba-rugi">Laba-Rugi</TabsTrigger>
          <TabsTrigger value="stok">Stok</TabsTrigger>
        </TabsList>
```

- [ ] **Step 5: Tambah `TabsContent value="stok"` baru, taruh persis sebelum `</Tabs>` penutup (setelah `TabsContent value="laba-rugi"` yang udah ada)**

```typescript
        <TabsContent value="stok" className="mt-4 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="stok-kind" className="text-sm text-muted-foreground">
                Jenis
              </Label>
              <Select value={stokKind} onValueChange={(v) => setStokKind(v as typeof stokKind)}>
                <SelectTrigger id="stok-kind" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="product">Produk</SelectItem>
                  <SelectItem value="sparepart">Sparepart</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {rangeValid && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/laporan/stok/print?from=${from}&to=${to}${stokKind !== 'all' ? `&kind=${stokKind}` : ''}`} target="_blank">
                  <Printer className="size-4" />
                  Cetak PDF
                </Link>
              </Button>
            )}
          </div>

          {stockQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {stockQuery.isError && <p className="text-sm text-destructive">Gagal memuat laporan stok.</p>}
          {stockQuery.data && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <SummaryCard label="Modal Tersisa (stok saat ini)" value={formatRupiah(stockQuery.data.ringkasan.totalModalTersisa)} />
                <SummaryCard label="Omzet Terjual (rentang ini)" value={formatRupiah(stockQuery.data.ringkasan.totalOmzetTerjual)} />
                <SummaryCard label="Untung Terjual (rentang ini)" value={formatRupiah(stockQuery.data.ringkasan.totalUntungTerjual)} />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Rincian per Item</CardTitle>
                  <CardDescription>
                    Baris menjorok &quot;Unit ...&quot; di bawah produk AC Indoor berpasangan = ringkasan gabungan Indoor+Outdoor (Point 2).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama</TableHead>
                        <TableHead className="text-right">Stok Awal</TableHead>
                        <TableHead className="text-right">Masuk</TableHead>
                        <TableHead className="text-right">Keluar</TableHead>
                        <TableHead className="text-right">Sisa</TableHead>
                        <TableHead className="text-right">Modal Tersisa</TableHead>
                        <TableHead className="text-right">Omzet</TableHead>
                        <TableHead className="text-right">Untung</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockQuery.data.items.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                            Tidak ada item.
                          </TableCell>
                        </TableRow>
                      )}
                      {stockQuery.data.items.map((row) => (
                        <React.Fragment key={`${row.itemKind}-${row.refId}`}>
                          <TableRow>
                            <TableCell>
                              {row.name}
                              <Badge variant="outline" className="ml-2 capitalize">
                                {row.itemKind}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{row.stokAwal}</TableCell>
                            <TableCell className="text-right">{row.stokMasuk}</TableCell>
                            <TableCell className="text-right">{row.stokKeluar}</TableCell>
                            <TableCell className="text-right">{row.sisaStok}</TableCell>
                            <TableCell className="text-right">{formatRupiah(row.modalTersisa)}</TableCell>
                            <TableCell className="text-right">{formatRupiah(row.omzetTerjual)}</TableCell>
                            <TableCell className="text-right">{formatRupiah(row.untungTerjual)}</TableCell>
                          </TableRow>
                          {row.unitGabungan && (
                            <TableRow className="bg-muted/40">
                              <TableCell className="pl-8 text-xs text-muted-foreground">
                                ↳ Unit {row.unitGabungan.namaPasangan}
                              </TableCell>
                              <TableCell />
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {row.unitGabungan.stokMasuk}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {row.unitGabungan.stokKeluar}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {row.unitGabungan.sisaStok}
                              </TableCell>
                              <TableCell />
                              <TableCell />
                              <TableCell />
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/laporan/page.tsx"
git commit -m "feat(laporan): tab Stok - rincian per item + baris Unit AC berpasangan (Point 4)"
```

---

### Task 6: Frontend — halaman print "Laporan Stok"

**Files:**
- Create: `src/app/(dashboard)/laporan/stok/print/page.tsx`
- Create: `src/app/(dashboard)/laporan/stok/print/stok-print-client.tsx`

Pola SAMA PERSIS kayak `src/app/(dashboard)/invoices/[id]/print/` (page.tsx server component tipis pakai `requireSession()` + client component isi tabel, `window.print()`, `@page { size: A4; margin: 12mm; }`, `print:hidden` buat tombol) — BUKAN library PDF baru, browser Print-to-PDF (spec Point 4: "reuse pattern print-friendly kayak halaman invoice yang udah ada").

- [ ] **Step 1: Buat `page.tsx`**

```typescript
// src/app/(dashboard)/laporan/stok/print/page.tsx
import { requireSession } from '@/lib/server-api';
import { StokPrintClient } from './stok-print-client';

export default async function StokPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; kind?: string }>;
}) {
  const { from, to, kind } = await searchParams;
  await requireSession();
  return <StokPrintClient from={from ?? ''} to={to ?? ''} kind={kind} />;
}
```

- [ ] **Step 2: Buat `stok-print-client.tsx`**

```typescript
// src/app/(dashboard)/laporan/stok/print/stok-print-client.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatRupiah, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';

interface StockReportRow {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  stokAwal: number;
  stokMasuk: number;
  stokKeluar: number;
  sisaStok: number;
  modalTersisa: number;
  omzetTerjual: number;
  untungTerjual: number;
  unitGabungan?: { namaPasangan: string; stokMasuk: number; stokKeluar: number; sisaStok: number };
}

interface StockReport {
  items: StockReportRow[];
  ringkasan: { totalModalTersisa: number; totalOmzetTerjual: number; totalUntungTerjual: number };
}

export function StokPrintClient({ from, to, kind }: { from: string; to: string; kind?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'stock-movements', 'print', from, to, kind],
    queryFn: () =>
      apiClient.get<StockReport>(
        `/reports/stock-movements?from=${from}&to=${to}${kind ? `&kind=${kind}` : ''}`,
      ),
    enabled: Boolean(from && to),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat laporan...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat laporan stok.</p>;

  return (
    <div className="mx-auto max-w-[297mm]">
      {/* Laporan tabular (banyak kolom) — pola @page A4 landscape, beda dari
          invoice yang portrait, biar semua kolom muat gak kepotong. */}
      <style>{'@page { size: A4 landscape; margin: 10mm; }'}</style>

      <div className="mb-4 flex items-center justify-end print:hidden">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak
        </Button>
      </div>

      <div className="bg-white p-2 text-black">
        <div className="text-center">
          <p className="text-lg font-bold">AYUB AC</p>
          <p className="text-sm font-semibold">Laporan Stok</p>
          <p className="text-xs">
            {formatDate(from)} — {formatDate(to)}
          </p>
        </div>

        <table className="mt-3 w-full border-collapse border border-black text-[9px]">
          <thead>
            <tr>
              <th className="border border-black p-1">Nama</th>
              <th className="border border-black p-1">Jenis</th>
              <th className="border border-black p-1">Stok Awal</th>
              <th className="border border-black p-1">Masuk</th>
              <th className="border border-black p-1">Keluar</th>
              <th className="border border-black p-1">Sisa</th>
              <th className="border border-black p-1">Modal Tersisa</th>
              <th className="border border-black p-1">Omzet</th>
              <th className="border border-black p-1">Untung</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <>
                <tr key={`${row.itemKind}-${row.refId}`}>
                  <td className="border border-black p-1">{row.name}</td>
                  <td className="border border-black p-1 text-center capitalize">{row.itemKind}</td>
                  <td className="border border-black p-1 text-right">{row.stokAwal}</td>
                  <td className="border border-black p-1 text-right">{row.stokMasuk}</td>
                  <td className="border border-black p-1 text-right">{row.stokKeluar}</td>
                  <td className="border border-black p-1 text-right">{row.sisaStok}</td>
                  <td className="border border-black p-1 text-right">{formatRupiah(row.modalTersisa)}</td>
                  <td className="border border-black p-1 text-right">{formatRupiah(row.omzetTerjual)}</td>
                  <td className="border border-black p-1 text-right">{formatRupiah(row.untungTerjual)}</td>
                </tr>
                {row.unitGabungan && (
                  <tr key={`${row.itemKind}-${row.refId}-unit`}>
                    <td className="border border-black p-1 pl-4 italic">↳ Unit {row.unitGabungan.namaPasangan}</td>
                    <td className="border border-black p-1" />
                    <td className="border border-black p-1" />
                    <td className="border border-black p-1 text-right">{row.unitGabungan.stokMasuk}</td>
                    <td className="border border-black p-1 text-right">{row.unitGabungan.stokKeluar}</td>
                    <td className="border border-black p-1 text-right">{row.unitGabungan.sisaStok}</td>
                    <td className="border border-black p-1" />
                    <td className="border border-black p-1" />
                    <td className="border border-black p-1" />
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>

        <table className="mt-2 w-64 border-collapse border border-black text-[9px]">
          <tbody>
            <tr>
              <td className="border border-black p-1 font-bold">Total Modal Tersisa</td>
              <td className="border border-black p-1 text-right">{formatRupiah(data.ringkasan.totalModalTersisa)}</td>
            </tr>
            <tr>
              <td className="border border-black p-1 font-bold">Total Omzet Terjual</td>
              <td className="border border-black p-1 text-right">{formatRupiah(data.ringkasan.totalOmzetTerjual)}</td>
            </tr>
            <tr>
              <td className="border border-black p-1 font-bold">Total Untung Terjual</td>
              <td className="border border-black p-1 text-right">{formatRupiah(data.ringkasan.totalUntungTerjual)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/laporan/stok/print/page.tsx" "src/app/(dashboard)/laporan/stok/print/stok-print-client.tsx"
git commit -m "feat(laporan): halaman print Laporan Stok (browser print, pola sama invoice) - Point 4"
```

---

## Verifikasi akhir (dilakuin manual di device asli, gak bisa di sandbox — gak ada DB)

- [ ] `npx prisma generate` (backend) — TIDAK ADA migrasi baru di plan ini, tapi jalanin ini aja buat mastiin client Prisma sinkron sama skema yang udah ada dari Point 2/3.
- [ ] `npm run build` (backend) — pastiin gak ada TS error.
- [ ] `npx jest` (backend) — full suite, termasuk 2 spec baru Task 1 & 2.
- [ ] `npm run build` (frontend) — pastiin gak ada TS error di halaman baru.
- [ ] Smoke test manual: buka `/laporan` → tab "Stok" → pilih rentang tanggal yang ada transaksi → cek angka Masuk/Keluar/Sisa masuk akal dibanding halaman Master Data Produk/Sparepart & histori Barang Masuk/POS.
- [ ] Smoke test khusus Point 2: cari produk AC yang dipasangkan (`pairedProductId` keisi) yang pernah dijual/masuk lewat mode "Unit Lengkap" → pastiin baris "↳ Unit ..." muncul di bawah baris Indoor-nya dengan angka Masuk/Keluar/Sisa yang masuk akal (Sisa Unit = MIN dari sisa Indoor & Outdoor).
- [ ] Klik "Cetak PDF" dari tab Stok → pastiin kebuka tab baru `/laporan/stok/print?...` dan `window.print()` nampilin preview yang rapi (landscape A4).

## Self-review plan (sebelum eksekusi)

- **Spec coverage**: Stok Awal/Masuk/Keluar (Task 3, `stock_movements`) ✅. Sisa Stok & Value Stok 2-angka-terpisah (Task 3, `item_costs`/`spareparts` + `invoice_items`) ✅. Filter tanggal wajib + item opsional (Task 2/4) ✅. Export PDF reuse pola invoice (Task 6) ✅. Baris "3 terpisah" buat AC berpasangan + Sisa Unit = MIN (Task 1 & 3) ✅.
- **No placeholder**: semua step punya kode lengkap, gak ada "implement later"/"TBD".
- **Type consistency**: `StockReportRow`/`buildStockReportRow` (Task 1) dipakai identik di `reports.service.ts` (Task 3) dan direplikasi manual jadi interface FE (Task 5 & 6, gak bisa share types lintas repo backend/frontend — pola yang sama kayak semua report lain di codebase ini).
