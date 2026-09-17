# E-POS AC — Implementation Plan: Siklus 8 — Laporan & Dashboard (Backend NestJS)

**Goal:** Admin bisa lihat laporan penjualan/servis/laba-rugi dengan filter tanggal, monitoring dashboard ringkas buat first-load sebelum WebSocket ambil alih, dan setting aplikasi (pajak, printer, format nota) yang selama ini hardcode/diinput manual tiap transaksi.

**Tech Stack:** sama persis Siklus 1 — NestJS + Prisma + PostgreSQL, `PrismaService`, `RolesGuard`+`@Roles()`, `@nestjs/websockets`. **Gak ada modul/service baru yang dobel** — siklus ini murni query agregat dari data yang udah dicatat Siklus 1 (dan opsional Siklus 3 buat `item_costs`).

**Reuse wajib dari Siklus 1** (jangan bikin ulang): `PrismaService` (`src/prisma/prisma.service.ts`), `JwtAuthGuard`+`RolesGuard`+`@Roles()` (`src/auth/guards/*`, `src/auth/decorators/roles.decorator.ts`), `@CurrentUser()` decorator, struktur tabel `invoices`/`invoice_items`/`transactions`/`transaction_items`/`technician_jobs`.

---

## Ruang lingkup siklus ini

**Termasuk:** `AppConfigModule` (CRUD key-value setting), `GET /reports/sales`, `GET /reports/service`, `GET /reports/profit-loss`, `GET /dashboard/summary`.

**Sengaja di luar scope:**
- Laporan performa kasir per shift (rekonsiliasi kas) — itu bagian **Siklus 4 (Kas & Shift Kasir)**, karena butuh tabel `cashier_shifts` yang belum ada. Siklus 8 ini cuma kebagian performa **teknisi** (lewat `reports/service`) dan angka transaksi/omzet harian generik di `dashboard/summary` — bukan breakdown per kasir individual. Lihat poin di "Keputusan desain".
- Export PDF/Excel laporan — endpoint di sini balikin JSON mentah, biar Next.js yang render tabel/grafik & handle export kalau dibutuhin nanti. Nggak nambah dependency PDF/Excel generator di backend buat sekarang (hindari over-engineering, skala 1 toko).
- Refactor `formatInvoiceNumber` jadi baca format dari `app_config` — disinggung sebagai catatan opsional di Task 0.1, bukan task wajib.

## Keputusan desain

1. **[PENTING] Keterbatasan `item_costs` buat laporan laba-rugi historis.** Skema asli:
   ```sql
   CREATE TABLE public.item_costs (
       kind text NOT NULL,
       ref_id text NOT NULL,
       buy_price numeric(14,2) NOT NULL,
       updated_at timestamp(3) without time zone NOT NULL
   );
   ALTER TABLE ONLY public.item_costs ADD CONSTRAINT item_costs_pkey PRIMARY KEY (kind, ref_id);
   ```
   Tabel ini cuma nyimpen **SATU** `buy_price` **TERKINI** per `(kind, ref_id)` — bukan snapshot histori harga beli di tiap waktu. Konsekuensinya: kalau harga beli sparepart/produk berubah dari waktu ke waktu (misal bulan Januari beli kapasitor Rp 50rb, bulan Juni naik jadi Rp 65rb), laporan laba-rugi untuk transaksi **Januari** yang di-generate hari ini bakal pakai `buy_price` Rp 65rb (harga terkini), bukan Rp 50rb (harga yang beneran berlaku waktu transaksi itu terjadi). Angka laba-rugi historis jadi kurang akurat kalau harga beli sering berubah signifikan.

   Ada 2 opsi, **pilih salah satu bareng tim sebelum mulai coding Fase 3** — plan ini nulis kode buat opsi (a) sebagai default (lebih simpel, sesuai skala), tapi opsi (b) juga disediain penuh siap pakai kalau tim mau akurasi lebih tinggi:

   - **Opsi (a) — Terima keterbatasan ini untuk sekarang.** Skala toko kecil, harga beli sparepart AC biasanya nggak berubah drastis/sering (beda kasus sama komoditas yang harganya fluktuatif harian). Cukup akurat buat kebutuhan laporan bulanan toko sekarang. **Nggak butuh migration apa-apa** — langsung pakai `item_costs` join biasa (Task 3.1). Kalau nanti ternyata harga beli sering berubah dan laporan jadi keliatan aneh, baru upgrade ke opsi (b).
   - **Opsi (b) — Snapshot `unit_cost` per baris item saat checkout.** Tambah migration kolom `unit_cost` (nullable, buat kompatibel sama data lama) di `transaction_items` & `invoice_items`, di-isi dari `item_costs.buy_price` **pas checkout terjadi** (bukan pas laporan di-generate). Laporan laba-rugi baca `unit_cost` yang udah nyantol di baris, jadi akurat walau harga beli berubah setelahnya. Trade-off: nambah 1 kolom + ubah dikit `PosService.checkout()` Siklus 1 (Task 4.4) buat lookup `item_costs` pas nyusun `priced` map. Ditulis lengkap di Task 3.2 (opsional) kalau tim pilih ini.

   **Keputusan ini didokumentasikan, bukan diputuskan sepihak — user/tim yang final decide (a) atau (b) sebelum Fase 3 dikerjain.**

2. **`GET /app-config` dibuka buat semua role login (bukan cuma admin)**, karena kasir butuh baca `default_tax_percent` buat prefill form checkout, dan siapapun yang nyetak nota butuh `invoice_footer_note`/`printer_name`. `PUT /app-config/:key` tetap admin-only — cuma admin yang boleh ubah setting.
3. **`invoice_number_format` disimpan di `app_config` tapi belum otomatis dipakai.** Format nomor invoice `INV-YYYYMMDD-XXXX` sekarang hardcode di `formatInvoiceNumber()` (`src/pos/pos-calc.util.ts`, Siklus 1 Task 4.3). Bikin itu baca dari `app_config` butuh refactor: `PosService.checkout()` fetch config dulu sebelum panggil `formatInvoiceNumber`, dan fungsi itu sendiri perlu parser template sederhana (`{YYYYMMDD}`, `{SEQ}`). **Ditulis sebagai catatan, bukan task wajib siklus ini** — kalau mau, kerjain belakangan sebagai polish kecil.
4. **Semua endpoint laporan pakai `invoices.created_at` sebagai sumber tanggal** (bukan `transactions.created_at`, walau nilainya sama karena invoice selalu dibuat bareng transaksi di `PosService.checkout()`) — konsisten satu sumber kebenaran buat semua query rentang tanggal.
5. **Query agregat pakai campuran Prisma `groupBy` (buat yang sederhana) dan raw SQL (`$queryRaw`) buat yang butuh `GROUP BY` tanggal/`JOIN` manual/`AVG` durasi** — Prisma `groupBy` nggak bisa `DATE_TRUNC` atau join tabel lain, jadi dipaksa raw SQL di titik-titik itu. Ini bukan penyimpangan konvensi, sama persis semangat `StockLockingService` Siklus 1 yang udah duluan pakai `$queryRawUnsafe` buat kasus yang Prisma Client nggak cover.
6. **Hasil `COUNT(*)` dari raw SQL Postgres balik sebagai `BigInt` di Prisma**, dan `JSON.stringify` bawaan Nest bakal error kalau ada `BigInt` mentah di response. Semua angka dari `$queryRaw` di plan ini di-`Number()`-kan eksplisit sebelum di-return — jangan skip langkah ini.

## Peta modul (tambahan ke struktur `src/` Siklus 1)

```
src/
  app-config/      → CRUD app_config (key-value setting: pajak, printer, footer nota)
  reports/         → GET /reports/sales, /reports/service, /reports/profit-loss
  dashboard/       → GET /dashboard/summary
```

---

## Fase 0 — AppConfigModule

### Task 0.1: Schema — model `AppConfig`

**File:** Modify `prisma/schema.prisma` (tabel `app_config` udah ada dari `db pull` Siklus 1 Task 0.1, cuma pastikan mapping-nya bener — nggak butuh migration baru karena tabelnya udah ada)

```prisma
model AppConfig {
  key   String  @id
  value String?

  @@map("app_config")
}
```

**Verifikasi:** `npx prisma studio` → tabel `app_config` kebuka, kolom `key`/`value` sesuai.

### Task 0.2: AppConfigModule — service & controller

**File:**
- Create: `src/app-config/app-config.module.ts`
- Create: `src/app-config/app-config.service.ts`
- Create: `src/app-config/app-config.controller.ts`
- Create: `src/app-config/dto/update-app-config.dto.ts`

Key standar yang dipakai aplikasi (nilai default kalau row belum ada di DB — dipakai `printer_name`/`invoice_footer_note` kosong itu wajar buat toko yang belum setup printer):

| key | contoh value | dipakai di |
|---|---|---|
| `default_tax_percent` | `"11"` | prefill `taxPercent` form checkout kasir |
| `invoice_footer_note` | `"Terima kasih sudah pakai jasa kami"` | footer cetak nota |
| `printer_name` | `"EPSON-LX310-Kasir1"` | Next.js pilih printer default |
| `invoice_number_format` | `"INV-{YYYYMMDD}-{SEQ}"` | **belum otomatis dipakai**, lihat Keputusan desain #3 |

```typescript
// src/app-config/app-config.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CONFIG: Record<string, string> = {
  default_tax_percent: '0',
  invoice_footer_note: '',
  printer_name: '',
  invoice_number_format: 'INV-{YYYYMMDD}-{SEQ}',
};

@Injectable()
export class AppConfigService {
  constructor(private prisma: PrismaService) {}

  /** Balikin semua config sebagai map key->value, di-fallback ke default kalau row belum pernah diisi admin. */
  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.appConfig.findMany();
    const map: Record<string, string> = { ...DEFAULT_CONFIG };
    for (const row of rows) {
      if (row.value !== null) map[row.key] = row.value;
    }
    return map;
  }

  async upsert(key: string, value: string) {
    return this.prisma.appConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
```

```typescript
// src/app-config/dto/update-app-config.dto.ts
import { IsString } from 'class-validator';

export class UpdateAppConfigDto {
  @IsString() value: string;
}
```

```typescript
// src/app-config/app-config.controller.ts
import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppConfigService } from './app-config.service';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('app-config')
export class AppConfigController {
  constructor(private service: AppConfigService) {}

  @Get()
  getAll() {
    // dibuka buat semua role login (bukan cuma admin) — kasir & printer nota butuh baca ini, lihat Keputusan desain #2
    return this.service.getAll();
  }

  @Roles('admin')
  @Put(':key')
  update(@Param('key') key: string, @Body() dto: UpdateAppConfigDto) {
    return this.service.upsert(key, dto.value);
  }
}
```

**Verifikasi:**
1. Login admin → `PUT /app-config/default_tax_percent` body `{ "value": "11" }` → 200.
2. `GET /app-config` (login kasir juga boleh) → `default_tax_percent: "11"`, key lain balik default (`printer_name: ""`, dst).
3. Login kasir → `PUT /app-config/printer_name` → 403 (bukan admin).

---

## Fase 1 — Laporan Penjualan

### Task 1.1: DTO rentang tanggal (dipakai bareng 3 endpoint laporan)

**File:** Create: `src/reports/dto/date-range.dto.ts`

```typescript
import { IsISO8601 } from 'class-validator';

export class DateRangeDto {
  @IsISO8601() from: string; // contoh: "2026-08-01"
  @IsISO8601() to: string;   // contoh: "2026-08-20"
}
```

**File:** Create: `src/reports/reports.util.ts`

```typescript
import { BadRequestException } from '@nestjs/common';

export function parseDateRange(from: string, to: string) {
  const start = new Date(from);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999); // "to" inklusif sampai akhir hari itu
  if (start.getTime() > end.getTime()) throw new BadRequestException('`from` tidak boleh setelah `to`');
  return { start, end };
}
```

### Task 1.2: ReportsService.sales()

**File:** Create: `src/reports/reports.service.ts`, `src/reports/reports.module.ts`

```typescript
// src/reports/reports.service.ts (bagian sales)
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async sales(start: Date, end: Date) {
    // 1) total & jumlah invoice dalam rentang
    const totals = await this.prisma.invoice.aggregate({
      where: { createdAt: { gte: start, lte: end } },
      _sum: { grandTotal: true, subtotal: true, discount: true, taxAmount: true },
      _count: { _all: true },
    });

    // 2) breakdown per kategori produk — invoice_items.ref_id gak strict FK ke products,
    //    jadi LEFT JOIN manual + fallback "Tanpa kategori" buat item yang produknya udah dihapus/ref_id null
    const byCategory: { category: string; total_line: string; qty: string }[] = await this.prisma.$queryRaw`
      SELECT COALESCE(p.category, 'Tanpa kategori') AS category,
             SUM(ii.line_total) AS total_line,
             SUM(ii.qty) AS qty
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN products p ON p.id = ii.ref_id
      WHERE ii.kind = 'product'
        AND i.created_at BETWEEN ${start} AND ${end}
      GROUP BY COALESCE(p.category, 'Tanpa kategori')
      ORDER BY total_line DESC
    `;

    // 3) grafik harian
    const daily: { date: Date; total: string; count: string }[] = await this.prisma.$queryRaw`
      SELECT DATE_TRUNC('day', created_at)::date AS date,
             SUM(grand_total) AS total,
             COUNT(*) AS count
      FROM invoices
      WHERE created_at BETWEEN ${start} AND ${end}
      GROUP BY 1
      ORDER BY 1
    `;

    return {
      totalPenjualan: Number(totals._sum.grandTotal ?? 0),
      totalInvoice: totals._count._all,
      totalDiskon: Number(totals._sum.discount ?? 0),
      totalPajak: Number(totals._sum.taxAmount ?? 0),
      breakdownKategori: byCategory.map((r) => ({
        category: r.category,
        totalLine: Number(r.total_line),
        qty: Number(r.qty),
      })),
      grafikHarian: daily.map((r) => ({
        date: r.date,
        total: Number(r.total),
        count: Number(r.count),
      })),
    };
  }
}
```

### Task 1.3: Controller `GET /reports/sales`

**File:** Create: `src/reports/reports.controller.ts`

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportsService } from './reports.service';
import { DateRangeDto } from './dto/date-range.dto';
import { parseDateRange } from './reports.util';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('sales')
  sales(@Query() query: DateRangeDto) {
    const { start, end } = parseDateRange(query.from, query.to);
    return this.reports.sales(start, end);
  }
}
```

**Verifikasi:**
1. Reuse skenario checkout Siklus 1 — bikin 2-3 transaksi retail (produk dengan `category` beda-beda) di hari yang sama.
2. `GET /reports/sales?from=2026-08-20&to=2026-08-20` (login admin) → `totalPenjualan` = jumlah manual `grand_total` semua invoice hari itu, `breakdownKategori` sesuai kategori produk yang dijual, `grafikHarian` ada 1 baris tanggal itu.
3. Login kasir hit endpoint yang sama → 403.

---

## Fase 2 — Laporan Servis

### Task 2.1: ReportsService.service()

**File:** Modify `src/reports/reports.service.ts` (tambah method)

```typescript
async service(start: Date, end: Date) {
  // 1) jumlah job per status (job yang dibuat dalam rentang tanggal)
  const byStatus = await this.prisma.technicianJob.groupBy({
    by: ['status'],
    where: { createdAt: { gte: start, lte: end } },
    _count: { _all: true },
  });

  // 2) rata-rata waktu pengerjaan (completed_at - started_at), cuma job yang beneran udah start & selesai
  const avgRows: { avg_minutes: string | null }[] = await this.prisma.$queryRaw`
    SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) AS avg_minutes
    FROM technician_jobs
    WHERE completed_at IS NOT NULL AND started_at IS NOT NULL
      AND completed_at BETWEEN ${start} AND ${end}
  `;

  // 3) performa per teknisi — jumlah job selesai
  const byTechnician: { technician_id: string; display_name: string; completed_count: string }[] = await this.prisma.$queryRaw`
    SELECT tj.technician_id, u.display_name, COUNT(*) AS completed_count
    FROM technician_jobs tj
    JOIN users u ON u.id = tj.technician_id
    WHERE tj.status = 'selesai'
      AND tj.completed_at BETWEEN ${start} AND ${end}
    GROUP BY tj.technician_id, u.display_name
    ORDER BY completed_count DESC
  `;

  return {
    jumlahPerStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    rataRataWaktuPengerjaanMenit: avgRows[0]?.avg_minutes ? Math.round(Number(avgRows[0].avg_minutes)) : null,
    performaTeknisi: byTechnician.map((t) => ({
      technicianId: t.technician_id,
      namaTeknisi: t.display_name,
      jobSelesai: Number(t.completed_count),
    })),
  };
}
```

### Task 2.2: Controller `GET /reports/service`

**File:** Modify `src/reports/reports.controller.ts` (tambah route di class yang sama)

```typescript
@Get('service')
service(@Query() query: DateRangeDto) {
  const { start, end } = parseDateRange(query.from, query.to);
  return this.reports.service(start, end);
}
```

**Verifikasi:**
1. Reuse skenario Siklus 1 Fase 5-6 — teknisi kerjain 2 job pemasangan sampai `selesai` (dengan `startedAt`/`completedAt` kecatat), 1 job masih `in_progress`.
2. `GET /reports/service?from=...&to=...` → `jumlahPerStatus` cocok (2 `selesai`, 1 `in_progress`), `rataRataWaktuPengerjaanMenit` masuk akal (bukan `null`, bukan negatif), `performaTeknisi` nunjukin 2 job buat teknisi yang ngerjain.

---

## Fase 3 — Laporan Laba-Rugi

> **Sebelum ngerjain fase ini, pastikan tim udah pilih opsi (a) atau (b) di Keputusan desain #1.** Task 3.1 di bawah pakai opsi (a) (default, gak ada migration). Task 3.2 nyediain opsi (b) lengkap kalau tim milih itu — jangan kerjain keduanya sekaligus.

### Task 3.1: ReportsService.profitLoss() — Opsi (a), pakai `item_costs` apa adanya

**File:** Modify `src/reports/reports.service.ts` (tambah method)

```typescript
async profitLoss(start: Date, end: Date) {
  const lines: {
    kind: string; ref_id: string | null; name: string;
    qty_sold: string; revenue: string; buy_price: string | null; cogs: string;
  }[] = await this.prisma.$queryRaw`
    SELECT ii.kind, ii.ref_id, ii.name,
           SUM(ii.qty) AS qty_sold,
           SUM(ii.line_total) AS revenue,
           MAX(ic.buy_price) AS buy_price,
           SUM(ii.qty * COALESCE(ic.buy_price, 0)) AS cogs
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    LEFT JOIN item_costs ic ON ic.kind = ii.kind AND ic.ref_id = ii.ref_id
    WHERE i.created_at BETWEEN ${start} AND ${end}
    GROUP BY ii.kind, ii.ref_id, ii.name
    ORDER BY revenue DESC
  `;

  const totalRevenue = lines.reduce((sum, l) => sum + Number(l.revenue), 0);
  const totalCogs = lines.reduce((sum, l) => sum + Number(l.cogs), 0);
  const grossProfit = totalRevenue - totalCogs;

  return {
    ringkasan: {
      totalPendapatan: totalRevenue,
      totalHpp: totalCogs, // HPP = harga pokok penjualan, cuma dari kind 'product'/'sparepart'; 'service' selalu HPP 0
      labaKotor: grossProfit,
      marginPersen: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 10000) / 100 : 0,
    },
    detailPerItem: lines.map((l) => ({
      kind: l.kind,
      refId: l.ref_id,
      name: l.name,
      qtyTerjual: Number(l.qty_sold),
      revenue: Number(l.revenue),
      buyPriceDipakai: l.buy_price ? Number(l.buy_price) : 0,
      hpp: Number(l.cogs),
      catatan:
        l.kind === 'service'
          ? 'Jasa servis — tidak ada HPP dari item_costs'
          : l.buy_price === null
          ? 'Belum ada data harga beli di item_costs — HPP dihitung 0 (perlu diisi lewat Siklus 3 barang masuk)'
          : 'HPP pakai buy_price TERKINI dari item_costs, lihat Keputusan desain #1',
    })),
  };
}
```

### Task 3.2: [OPSIONAL — cuma kalau tim pilih Opsi (b)] Migration `unit_cost` + perubahan `PosService.checkout()`

**File:** Modify `prisma/schema.prisma` + `npx prisma migrate dev --name add_unit_cost_snapshot`

```prisma
model TransactionItem {
  // ...field existing dari Siklus 1 tetap ada...
  unitCost Decimal? @map("unit_cost") @db.Decimal(14, 2)
}

model InvoiceItem {
  // ...field existing dari Siklus 1 tetap ada...
  unitCost Decimal? @map("unit_cost") @db.Decimal(14, 2)
}
```

`migration.sql` yang dihasilkan (nullable biar kompatibel sama baris lama yang belum punya snapshot):
```sql
ALTER TABLE "transaction_items" ADD COLUMN "unit_cost" numeric(14,2);
ALTER TABLE "invoice_items" ADD COLUMN "unit_cost" numeric(14,2);
```

Perubahan kecil di `PosService.checkout()` (Siklus 1, Task 4.4) — lookup `item_costs` bareng lookup harga jual, simpen di `priced` map, ikutan ditulis pas `transactionItem`/`invoiceItem` dibikin:

```typescript
// di dalam loop "1) kunci & kurangi stok..." — tambah lookup buy_price setelah lockAndDeduct
const priced = new Map<string, { name: string; unit: string; unitPrice: number; unitCost: number | null }>();
for (const item of sortedItems) {
  if (item.kind === 'service') {
    const svc = await tx.service.findUnique({ where: { id: item.refId } });
    if (!svc || !svc.active) throw new BadRequestException('Jasa tidak ditemukan/nonaktif');
    priced.set(item.refId, { name: svc.name, unit: 'jasa', unitPrice: Number(svc.basePrice), unitCost: null });
  } else {
    const { name, unitPrice } = await this.stockLocking.lockAndDeduct(tx, item.kind, item.refId, item.qty);
    const cost = await tx.itemCost.findUnique({ where: { kind_refId: { kind: item.kind, refId: item.refId } } });
    priced.set(item.refId, { name, unit: item.kind === 'product' ? 'unit' : 'pcs', unitPrice, unitCost: cost ? Number(cost.buyPrice) : null });
  }
}
```

```typescript
// pas create transactionItem & invoiceItem, tambah field unitCost:
await tx.transactionItem.create({ data: { transactionId: transaction.id, kind: item.kind, refId: item.refId,
  name: p.name, unit: p.unit, qty: item.qty, unitPrice: p.unitPrice, lineTotal,
  unitCost: p.unitCost /* snapshot harga beli SAAT checkout, bukan harga terkini */ } });
// ...sama buat invoiceItem...
```

Kalau Task 3.2 dikerjain, query `profitLoss()` di Task 3.1 diganti biar prioritaskan `unit_cost` yang udah nyantol di baris, fallback ke `item_costs` cuma buat baris lama sebelum migration ini jalan:

```sql
SELECT ii.kind, ii.ref_id, ii.name,
       SUM(ii.qty) AS qty_sold,
       SUM(ii.line_total) AS revenue,
       SUM(ii.qty * COALESCE(ii.unit_cost, ic.buy_price, 0)) AS cogs
FROM invoice_items ii
JOIN invoices i ON i.id = ii.invoice_id
LEFT JOIN item_costs ic ON ic.kind = ii.kind AND ic.ref_id = ii.ref_id
WHERE i.created_at BETWEEN $1 AND $2
GROUP BY ii.kind, ii.ref_id, ii.name
ORDER BY revenue DESC
```

**Verifikasi Task 3.2 (kalau dikerjain):** insert `item_costs` buy_price=50000 buat 1 sparepart → checkout jual sparepart itu → cek `transaction_items.unit_cost`/`invoice_items.unit_cost` = 50000. Update `item_costs.buy_price` jadi 65000 → checkout ulang transaksi baru → laporan laba-rugi buat transaksi LAMA tetap pakai 50000 (bukan ikut naik ke 65000), transaksi BARU pakai 65000.

### Task 3.3: Controller `GET /reports/profit-loss`

**File:** Modify `src/reports/reports.controller.ts`

```typescript
@Get('profit-loss')
profitLoss(@Query() query: DateRangeDto) {
  const { start, end } = parseDateRange(query.from, query.to);
  return this.reports.profitLoss(start, end);
}
```

**Verifikasi (Opsi a):**
1. Insert `item_costs` buat produk & sparepart yang bakal dijual: `INSERT INTO item_costs (kind, ref_id, buy_price, updated_at) VALUES ('product', '<id>', 2500000, now())`.
2. Checkout jual produk itu qty=1 harga jual 3500000.
3. `GET /reports/profit-loss?from=...&to=...` → `totalPendapatan` 3500000 (atau lebih kalau ada item lain), `detailPerItem` nunjukin item itu dengan `hpp` = 2500000, `catatan` nunjukin sumbernya `item_costs` terkini.
4. Checkout jual 1 produk lain yang **belum** ada di `item_costs` → baris itu di `detailPerItem` punya `hpp: 0` dan `catatan` "Belum ada data harga beli...".

---

## Fase 4 — Dashboard Ringkas

### Task 4.1: DashboardService.summary()

**File:** Create: `src/dashboard/dashboard.service.ts`, `src/dashboard/dashboard.module.ts`

```typescript
// src/dashboard/dashboard.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [jobsByStatus, todayTx, unpaidInvoices] = await Promise.all([
      this.prisma.technicianJob.groupBy({
        by: ['status'],
        where: { status: { notIn: ['selesai', 'dibatalkan'] } },
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        _count: { _all: true },
        _sum: { grandTotal: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['status'],
        where: { status: { in: ['belum_dibayar', 'dp'] } },
        _count: { _all: true },
      }),
    ]);

    return {
      jobAktifPerStatus: jobsByStatus.map((j) => ({ status: j.status, count: j._count._all })),
      transaksiHariIni: todayTx._count._all,
      omzetHariIni: Number(todayTx._sum.grandTotal ?? 0),
      invoiceBelumLunas: unpaidInvoices.map((i) => ({ status: i.status, count: i._count._all })),
    };
  }
}
```

Catatan: `jobAktifPerStatus` sengaja hitung **semua** job aktif (bukan cuma yang dibuat hari ini) — beda dari `reports/service` yang scoped ke rentang tanggal, karena tujuannya "progress servis yang lagi jalan sekarang", bukan laporan historis.

### Task 4.2: Controller `GET /dashboard/summary`

**File:** Create: `src/dashboard/dashboard.controller.ts`

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get('summary')
  summary() {
    return this.dashboard.summary();
  }
}
```

Endpoint ini **tidak** emit/listen WebSocket — ini murni snapshot buat first-load. Next.js panggil `GET /dashboard/summary` sekali pas halaman dashboard dibuka, lalu `RealtimeGateway` (`src/realtime/realtime.gateway.ts`, Siklus 1 Fase 8) yang jaga data tetap update tanpa refresh setelahnya lewat event `transaction.created`/`job.status_changed`/`invoice.updated` yang udah di-emit sepanjang Siklus 1.

**Verifikasi:**
1. `GET /dashboard/summary` sebelum ada transaksi hari ini → `transaksiHariIni: 0`, `omzetHariIni: 0`.
2. Checkout 1 transaksi baru (reuse Siklus 1) → `GET /dashboard/summary` lagi → `transaksiHariIni: 1`, `omzetHariIni` sesuai `grand_total` transaksi itu.
3. Bikin 1 job servis yang belum `selesai` → `jobAktifPerStatus` nunjukin job itu.
4. Checkout dengan pembayaran belum diverifikasi → `invoiceBelumLunas` nunjukin invoice itu dengan status `belum_dibayar`/`dp`.

---

## Fase 5 — Wiring modul ke `AppModule`

### Task 5.1: Daftarkan module baru

**File:** Modify `src/app.module.ts`

```typescript
@Module({
  imports: [
    // ...module Siklus 1 yang udah ada...
    AppConfigModule,
    ReportsModule,
    DashboardModule,
  ],
})
export class AppModule {}
```

**Verifikasi:** `npm run start:dev` nyala tanpa error, semua route baru muncul di log Nest (`Mapped {/app-config, GET} route`, dst).

---

## Skenario tes end-to-end (jalanin manual setelah semua fase kelar)

1. Login admin → `PUT /app-config/default_tax_percent` value `"11"` → `GET /app-config` nunjukin nilai itu.
2. Login admin → insert `item_costs` buat 1 produk & 1 sparepart (lewat `prisma studio` kalau Siklus 3 belum jalan, atau lewat endpoint Siklus 3 kalau udah).
3. Login kasir → checkout 2 transaksi (produk beda kategori, salah satunya pakai instalasi) di hari yang sama.
4. Login teknisi → kerjain job pemasangan sampai `selesai` (checklist, foto, notes, complete) — pastikan `started_at`/`completed_at` kecatat.
5. Login kasir → bayar salah satu invoice metode transfer + upload bukti, verifikasi via `PATCH /payments/:id/verify`.
6. Login admin → `GET /reports/sales?from=<hari-ini>&to=<hari-ini>` → cek `totalPenjualan`, `breakdownKategori`, `grafikHarian` cocok manual hitung dari transaksi langkah 3.
7. Login admin → `GET /reports/service?from=<hari-ini>&to=<hari-ini>` → cek `jumlahPerStatus`, `rataRataWaktuPengerjaanMenit`, `performaTeknisi` cocok langkah 4.
8. Login admin → `GET /reports/profit-loss?from=<hari-ini>&to=<hari-ini>` → cek item yang ada di `item_costs` (langkah 2) punya `hpp` bener, item yang nggak ada tetap muncul dengan `hpp: 0` + catatan.
9. Login admin → `GET /dashboard/summary` → cek `transaksiHariIni`, `omzetHariIni`, `jobAktifPerStatus`, `invoiceBelumLunas` semua konsisten sama langkah 3-5.
10. Login kasir/teknisi coba hit `/reports/*` atau `/dashboard/summary` → 403 di semuanya (admin-only).

Kalau 10 langkah ini lolos, Siklus 8 udah jalan penuh end-to-end di atas fondasi Siklus 1.

---

## Dependency

- **Siklus 1** (wajib, fondasi utama): `PrismaService`, `RolesGuard`+`@Roles()`, tabel `invoices`/`invoice_items`/`transactions`/`transaction_items`/`technician_jobs`, `RealtimeGateway` (dashboard nyambung ke situ buat live-update setelah first-load).
- **Siklus 3 — Manajemen Stok** (soft dependency buat `reports/profit-loss`): `item_costs` diisi dari endpoint `POST /stock/in` Siklus 3. Kalau Siklus 3 belum dikerjain, `reports/profit-loss` tetap jalan tapi semua `hpp` bakal 0 (ketahuan dari `catatan` di tiap baris) — nggak error, cuma nggak berguna sampai Siklus 3 ada.
- **Siklus 4 — Kas & Shift Kasir** (soft dependency, di luar scope Siklus 8): laporan performa **kasir** per shift itu tanggung jawab `GET /shifts/:id/report` di Siklus 4, bukan di sini — lihat "Ruang lingkup" & Keputusan desain di atas.
