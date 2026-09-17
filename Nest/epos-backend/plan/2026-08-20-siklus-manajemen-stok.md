# E-POS AC — Implementation Plan: Siklus 3 — Manajemen Stok (Admin)

**Goal:** Admin bisa catat barang masuk (restock produk/sparepart + update harga beli), lakukan stock opname (koreksi stok ke angka hasil hitung fisik dengan audit trail), dan lihat histori keluar-masuk stok per item — semua reuse `StockLockingService` yang sudah ada di Siklus 1, bukan bikin engine stok baru.

**Architecture:** Extend modul `common` yang sudah ada (`StockLockingService` nambah 1 method baru: `lockAndAdd`), plus 1 modul baru `src/stock/` yang isinya cuma 3 endpoint tipis di atas service yang sama. Semua operasi tulis-stok tetap lewat `SELECT ... FOR UPDATE` di dalam `$transaction` interactive Prisma — pola row-locking yang sama persis dengan Siklus 1, gak ada pola baru diperkenalkan di siklus ini.

**Tech Stack:** NestJS + TypeScript, Prisma + PostgreSQL, `class-validator`/`class-transformer`, `RolesGuard`+`@Roles('admin')` dari Siklus 1 (semua endpoint siklus ini admin-only, gak ada yang dipakai kasir/teknisi).

---

## Ruang lingkup siklus ini

**Termasuk:** `POST /stock/in` (barang masuk + update harga beli di `item_costs`), `POST /stock/opname` (koreksi stok hasil hitung fisik + audit log), `GET /stock/movements` (histori keluar-masuk stok per item, buat audit admin).

**Sengaja di luar scope siklus ini — transfer stock multi-cabang:** skala bisnis masih satu toko, jadi fitur ini gak direncanakan sama sekali (bukan cuma "belum", tapi memang gak relevan sampai ada cabang kedua beneran).

## Keputusan desain

1. **Reuse `StockLockingService`, bukan bikin service stok baru.** Method baru `lockAndAdd` ditaruh di file yang sama (`src/common/services/stock-locking.service.ts`) persis di sebelah `lockAndDeduct` dari Siklus 1 — biar satu tempat aja yang pegang logic row-locking stok, gampang di-review, dan module `stock/` cuma consumer.
2. **`lockAndAdd` sengaja TIDAK cek `active`**, beda dari `lockAndDeduct`. `lockAndDeduct` cek `active` karena itu jalur *jual ke customer* (item nonaktif gak boleh kejual). `lockAndAdd` dipakai buat *barang masuk* & *opname* — dua operasi ini justru sering dipakai buat item yang lagi nonaktif (mis. restock produk yang sempat di-nonaktifin karena kosong, atau opname korektif ke item yang lagi di-suspend). Row tetap di-lock (`FOR UPDATE`) dan tetap divalidasi *exists*, cuma gak diblokir gara-gara `active=false`.
3. **`item_costs` pakai composite primary key `(kind, ref_id)`** — sudah dikonfirmasi dari SQL dump asli (`ADD CONSTRAINT item_costs_pkey PRIMARY KEY (kind, ref_id)`), bukan `id` biasa. Di Prisma jadi `@@id([kind, refId])`, upsert-nya pakai key gabungan otomatis `kind_refId`. Kolom ini krusial buat laporan laba-rugi nanti (Siklus 8) — sekarang baru mulai diisi, belum dipakai baca.
4. **`stock_movements` gak punya kolom `note`** (cuma `id, item_kind, ref_id, name, qty_change, reason, transaction_id, created_by, created_at` — dikonfirmasi dari dump asli). Jadi `note` dari input `POST /stock/in` dan `POST /stock/opname` ditaruh di `audit_logs.detail` (jsonb) aja, bukan nambah migration kolom baru buat field opsional yang jarang dipakai.
5. **Opname mengoreksi stok LANGSUNG ke angka fisik** (`SET stock = $physicalQty`), bukan `increment`/`decrement` biasa. Ini beda semantik penting: opname itu "ini angka final hasil hitung tadi", bukan "tambah/kurang sekian dari angka sekarang" — kalau dipakai `increment` malah salah kalau ada race dengan transaksi lain di antara hitung fisik dan submit.
6. **Opname selalu insert `audit_logs` kalau `delta != 0`**, gak pakai threshold "selisih besar vs kecil" — karena nentuin ambang batas "besar" itu subjektif dan nambah kompleksitas yang gak perlu buat skala toko ini. Lebih aman & simpel: setiap koreksi opname yang mengubah stok, tercatat siapa & kapan, titik.
7. **Opname gak ada mekanisme "undo" otomatis.** Kalau admin salah ketik angka fisik pas opname, gak ada tombol "batalkan opname terakhir" — solusinya opname ulang manual dengan angka yang benar (bikin `stock_movements` row baru lagi dengan `reason='opname'`). Ini keputusan sadar demi kesederhanaan (skala toko kecil, cukup 1-2 orang admin yang pegang), bukan kelupaan — bikin fitur undo yang bener (harus reverse audit trail, bukan cuma hapus row) gak sepadan effort-nya buat skala ini.
8. **Urutan lock di opname multi-item di-sort by `refId`** sebelum diproses satu-satu — prinsip yang sama dengan Task 4.4 Siklus 1 (checkout), biar kalau ada 2 request opname/checkout barengan yang overlap itemnya, gak saling deadlock.
9. **Transfer stock multi-cabang di-skip total** — bukan future work yang berat, cuma gak relevan: toko ini masih satu lokasi fisik.

## Peta modul (file baru/modifikasi)

```
src/
  common/services/
    stock-locking.service.ts       → MODIFIKASI: tambah method lockAndAdd
    stock-locking.service.spec.ts  → MODIFIKASI: tambah test race condition lockAndAdd
  stock/
    stock.module.ts                → BARU
    stock.controller.ts            → BARU
    stock.service.ts               → BARU
    dto/
      stock-in.dto.ts               → BARU
      stock-opname.dto.ts           → BARU
      stock-movements-query.dto.ts  → BARU
```

Tidak ada migration Prisma baru — tabel `item_costs`, `stock_movements`, `products`, `spareparts`, `audit_logs` semuanya sudah ke-introspeksi di Task 0.1 Siklus 1 (`npx prisma db pull`). Cukup pastikan model `ItemCost` di `schema.prisma` punya `@@id([kind, refId])` sesuai poin 3 di atas (cek pas review hasil pull — kalau introspeksi Prisma udah otomatis kasih compound id, tinggal lanjut; kalau belum, tambahin manual).

---

## Fase 1 — Extend StockLockingService

### Task 1.1: Method `lockAndAdd`

**File:** Modify: `src/common/services/stock-locking.service.ts`

```typescript
@Injectable()
export class StockLockingService {
  // ... lockAndDeduct dari Siklus 1 tetap di sini, tidak diubah ...

  /**
   * Kunci baris produk/sparepart, validasi item exists, lalu tambah stok.
   * Harus dipanggil di dalam tx. Dipakai buat barang masuk & opname (kenaikan stok).
   * Beda dari lockAndDeduct: TIDAK cek `active` — barang masuk/opname boleh
   * dilakukan meski item lagi nonaktif (lihat Keputusan Desain #2).
   */
  async lockAndAdd(tx: any, kind: 'product' | 'sparepart', id: string, qty: number) {
    const table = kind === 'product' ? 'products' : 'spareparts';
    const rows: any[] = await tx.$queryRawUnsafe(
      `SELECT id, name, stock FROM ${table} WHERE id = $1 FOR UPDATE`, id,
    );
    const row = rows[0];
    if (!row) throw new BadRequestException(`Item ${id} tidak ditemukan`);

    await tx.$executeRawUnsafe(`UPDATE ${table} SET stock = stock + $1 WHERE id = $2`, qty, id);
    return { name: row.name as string, previousStock: Number(row.stock) };
  }
}
```

**Verifikasi:** unit test biasa — panggil `lockAndAdd` sekali di dalam `prisma.$transaction`, cek stok naik sesuai qty dan `previousStock` balikin angka sebelum ditambah.

### Task 1.2: Test race condition — dua barang-masuk bareng ke item yang sama

**File:** Modify: `src/common/services/stock-locking.service.spec.ts`

```typescript
it('dua barang-masuk bareng ke item yang sama, stok akhir harus akumulasi bener (gak ada lost update)', async () => {
  await prisma.product.create({ data: { id: 'p2', name: 'AC 2PK', sellPrice: 4000000, stock: 0, active: true } });

  await Promise.all([
    prisma.$transaction((tx) => stockLocking.lockAndAdd(tx, 'product', 'p2', 5)),
    prisma.$transaction((tx) => stockLocking.lockAndAdd(tx, 'product', 'p2', 5)),
  ]);

  const final = await prisma.product.findUnique({ where: { id: 'p2' } });
  expect(final.stock).toBe(10); // bukan 5 — kalau FOR UPDATE gak jalan, satu request bisa "baca stok basi"
  // (stok awal 0) dan overwrite hasil request satunya, alias lost update classic
});
```

Ini adaptasi langsung dari test race condition `lockAndDeduct` di Task 4.1 Siklus 1, cuma arahnya kebalik: di `lockAndDeduct` yang dibuktikan adalah "stok gak boleh minus" (satu request harus gagal), di `lockAndAdd` yang dibuktikan adalah "dua penambahan barengan harus terakumulasi penuh, gak ada yang ketimpa" — karena `lockAndAdd` gak pernah nge-reject (nambah stok gak ada batas atas), race condition-nya kalau ada justru berupa silent lost update, bukan error yang kelihatan.

**Verifikasi:** `npm test stock-locking.service.spec.ts` — kedua test (`lockAndDeduct` dari Siklus 1 + `lockAndAdd` baru) hijau.

---

## Fase 2 — StockModule: barang masuk

### Task 2.1: DTO `POST /stock/in`

**File:** Create: `src/stock/dto/stock-in.dto.ts`

```typescript
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class StockInDto {
  @IsIn(['product', 'sparepart']) kind: 'product' | 'sparepart';
  @IsString() @IsNotEmpty() refId: string;
  @IsNumber() @Min(0.01) qty: number;
  @IsNumber() @Min(0) buyPrice: number;
  @IsOptional() @IsString() note?: string;
}
```

### Task 2.2: `StockService.stockIn` — transaksi barang masuk

**File:** Create: `src/stock/stock.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService } from '../common/services/stock-locking.service';
import { StockInDto } from './dto/stock-in.dto';
import { StockOpnameDto } from './dto/stock-opname.dto';
import { StockMovementsQueryDto } from './dto/stock-movements-query.dto';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService, private stockLocking: StockLockingService) {}

  async stockIn(dto: StockInDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { name, previousStock } = await this.stockLocking.lockAndAdd(tx, dto.kind, dto.refId, dto.qty);

      const movement = await tx.stockMovement.create({
        data: {
          itemKind: dto.kind, refId: dto.refId, name,
          qtyChange: dto.qty, reason: 'barang_masuk', createdBy: actorId,
        },
      });

      // upsert harga beli terbaru — dipakai laporan laba-rugi di siklus lain, belum dibaca di sini
      await tx.itemCost.upsert({
        where: { kind_refId: { kind: dto.kind, refId: dto.refId } },
        update: { buyPrice: dto.buyPrice, updatedAt: new Date() },
        create: { kind: dto.kind, refId: dto.refId, buyPrice: dto.buyPrice, updatedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorUid: actorId, action: 'stock.in', target: dto.refId,
          detail: { kind: dto.kind, name, qty: dto.qty, buyPrice: dto.buyPrice, previousStock, note: dto.note ?? null },
        },
      });

      return { movementId: movement.id, kind: dto.kind, refId: dto.refId, name, previousStock, newStock: previousStock + dto.qty };
    });
  }

  // ... opname & findMovements di Task 3.2 & 4.1 ...
}
```

**Verifikasi:** `POST /stock/in` produk stock 5 → qty 10 → cek `GET /products/:id` stock jadi 15, `stock_movements` ada row baru `reason='barang_masuk'` `qty_change=10`, `item_costs` (kind='product', ref_id=<id>) ke-upsert dengan `buy_price` sesuai input.

### Task 2.3: Controller & module wiring

**File:** Create: `src/stock/stock.controller.ts`, `src/stock/stock.module.ts`

```typescript
// stock.controller.ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('stock')
export class StockController {
  constructor(private stockService: StockService) {}

  @Post('in')
  stockIn(@Body() dto: StockInDto, @CurrentUser() user: any) {
    return this.stockService.stockIn(dto, user.sub);
  }
}
```

```typescript
// stock.module.ts
@Module({
  imports: [PrismaModule, CommonModule], // CommonModule expose StockLockingService (sama seperti PosModule di Siklus 1)
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
```

**Verifikasi:** hit `POST /stock/in` pakai token role `kasir`/`teknisi` → 403 (endpoint ini admin-only, beda dari checkout yang admin+kasir boleh).

---

## Fase 3 — Stock Opname

### Task 3.1: DTO `POST /stock/opname`

**File:** Create: `src/stock/dto/stock-opname.dto.ts`

```typescript
import { ArrayMinSize, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class OpnameItemDto {
  @IsIn(['product', 'sparepart']) kind: 'product' | 'sparepart';
  @IsString() @IsNotEmpty() refId: string;
  @IsNumber() @Min(0) physicalQty: number; // hasil hitung fisik, angka final — bukan delta
}

export class StockOpnameDto {
  @ValidateNested({ each: true }) @Type(() => OpnameItemDto) @ArrayMinSize(1) items: OpnameItemDto[];
  @IsOptional() @IsString() note?: string;
}
```

### Task 3.2: `StockService.opname`

**File:** Modify: `src/stock/stock.service.ts`

```typescript
async opname(dto: StockOpnameDto, actorId: string) {
  return this.prisma.$transaction(async (tx) => {
    // sort by refId dulu — hindari deadlock kalau ada opname/checkout lain jalan barengan
    // dengan item overlap tapi urutan beda (prinsip sama dengan Task 4.4 Siklus 1)
    const sorted = [...dto.items].sort((a, b) => a.refId.localeCompare(b.refId));
    const results: any[] = [];

    for (const item of sorted) {
      const table = item.kind === 'product' ? 'products' : 'spareparts';
      const rows: any[] = await tx.$queryRawUnsafe(
        `SELECT id, name, stock FROM ${table} WHERE id = $1 FOR UPDATE`, item.refId,
      );
      const row = rows[0];
      if (!row) throw new BadRequestException(`Item ${item.refId} tidak ditemukan`);

      const systemQty = Number(row.stock);
      const delta = item.physicalQty - systemQty;

      if (delta === 0) {
        results.push({ refId: item.refId, name: row.name, systemQty, physicalQty: item.physicalQty, delta: 0 });
        continue; // gak ada selisih, gak perlu stock_movements atau audit_logs
      }

      // koreksi LANGSUNG ke angka fisik (bukan increment/decrement) — ini "angka final", bukan penambahan relatif
      await tx.$executeRawUnsafe(`UPDATE ${table} SET stock = $1 WHERE id = $2`, item.physicalQty, item.refId);

      await tx.stockMovement.create({
        data: { itemKind: item.kind, refId: item.refId, name: row.name, qtyChange: delta, reason: 'opname', createdBy: actorId },
      });

      // WAJIB: opname sensitif, harus jelas siapa & kapan — selalu dicatat tiap ada selisih, tanpa threshold "besar/kecil"
      await tx.auditLog.create({
        data: {
          actorUid: actorId, action: 'stock.opname', target: item.refId,
          detail: { kind: item.kind, name: row.name, systemQty, physicalQty: item.physicalQty, delta, note: dto.note ?? null },
        },
      });

      results.push({ refId: item.refId, name: row.name, systemQty, physicalQty: item.physicalQty, delta });
    }

    return results;
  });
}
```

**Catatan:** kalau admin salah ketik `physicalQty` pas opname, gak ada endpoint "undo" — perbaikannya opname ulang manual dengan angka yang benar (lihat Keputusan Desain #7).

**Verifikasi:**
1. Sparepart stok sistem 20, opname `physicalQty: 17` → `stock_movements` row baru `reason='opname'` `qty_change=-3`, `audit_logs` ada row `action='stock.opname'` dengan `detail.delta=-3`, stok akhir sparepart = 17 (bukan 20-3 lewat jalur lain, langsung di-`SET`).
2. Opname 2 item sekaligus dalam 1 request, salah satu `physicalQty` sama dengan stok sistem (delta=0) → item itu gak bikin row `stock_movements`/`audit_logs` baru, item satunya (yang beda) tetap tercatat.

---

## Fase 4 — Histori Stock Movements

### Task 4.1: `GET /stock/movements`

**File:**
- Create: `src/stock/dto/stock-movements-query.dto.ts`
- Modify: `src/stock/stock.service.ts`, `src/stock/stock.controller.ts`

```typescript
// stock-movements-query.dto.ts
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class StockMovementsQueryDto {
  @IsOptional() @IsIn(['product', 'sparepart']) itemKind?: 'product' | 'sparepart';
  @IsOptional() @IsString() refId?: string;
  @IsOptional() @IsString() reason?: string; // 'penjualan' | 'pemakaian_servis' | 'barang_masuk' | 'opname'
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
```

```typescript
// stock.service.ts — tambahan method
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
    take: 200, // guard sederhana biar gak query tanpa batas — cukup buat skala 1 toko, gak perlu pagination formal dulu
  });
}
```

```typescript
// stock.controller.ts — tambahan route
@Get('movements')
findMovements(@Query() query: StockMovementsQueryDto) {
  return this.stockService.findMovements(query);
}
```

Endpoint ini sengaja read-only dan gak butuh transaksi/locking — cuma query biasa ke tabel yang sudah tercatat dari 3 jalur berbeda: checkout (Siklus 1, `reason='penjualan'`), sparepart tambahan servis (Siklus 1, `reason='pemakaian_servis'`), dan dua endpoint di siklus ini (`reason='barang_masuk'`/`'opname'`) — jadi `GET /stock/movements` otomatis jadi histori lengkap lintas siklus tanpa kerja tambahan, karena semua jalur udah nulis ke tabel yang sama.

**Verifikasi:** setelah Task 2.2 & Task 3.2 dijalankan sekali masing-masing, `GET /stock/movements?refId=<id produk>` balikin minimal 2 row (`barang_masuk` & kalau ada `opname`nya), urut `createdAt desc`. `GET /stock/movements?reason=opname&from=2026-08-20&to=2026-08-20` cuma balikin row opname hari itu.

---

## Skenario tes end-to-end (jalanin manual setelah semua fase kelar)

1. Login admin (pakai kredensial seed dari Siklus 1) → `POST /products` bikin 1 produk stock=0.
2. `POST /stock/in` untuk produk itu, `qty=10`, `buyPrice=2500000`, `note="restock awal dari supplier X"`.
3. Cek `GET /products/:id` stock jadi 10.
4. Cek DB: `stock_movements` ada row `reason='barang_masuk'` `qty_change=10`; `item_costs` ada row `(kind='product', ref_id=<id>)` dengan `buy_price=2500000`; `audit_logs` ada row `action='stock.in'` dengan `detail.note` sesuai isian.
5. `POST /stock/opname` untuk produk yang sama, `physicalQty=8` (misal 2 rusak/hilang pas hitung fisik).
6. Cek `GET /products/:id` stock jadi 8 (bukan 10-2 lewat jalur increment, langsung di-`SET` ke 8).
7. Cek DB: `stock_movements` ada row baru `reason='opname'` `qty_change=-2`; `audit_logs` ada row `action='stock.opname'` dengan `detail.systemQty=10`, `detail.physicalQty=8`, `detail.delta=-2`.
8. `GET /stock/movements?refId=<id produk>` balikin 2 row di atas, urut terbaru dulu.
9. Login sebagai kasir → `POST /stock/in` dengan token itu → 403 (bukti endpoint ini admin-only).
10. Jalankan test race condition Task 1.2 (`lockAndAdd`) — hijau, stok akumulasi bener buat 2 request barengan.

Kalau semua 10 langkah lolos, siklus manajemen stok ini beres dan datanya siap dikonsumsi Siklus 8 (laporan laba-rugi, karena `item_costs` udah mulai keisi).

---

## Dependency

- **Siklus 1** (`2026-08-20-siklus-penjualan-instalasi-servis.md`) — wajib sudah diimplementasi duluan, karena siklus ini reuse langsung:
  - `src/common/services/stock-locking.service.ts` (di-extend, bukan diganti)
  - `PrismaService`, struktur `prisma/schema.prisma` hasil introspeksi Task 0.1 (tabel `products`, `spareparts`, `stock_movements`, `item_costs`, `audit_logs` sudah ada)
  - `RolesGuard` + `@Roles()` + `JwtAuthGuard` + `CurrentUser` decorator dari `src/auth/`
  - Pola `tx.auditLog.create(...)` yang sama persis dipakai di `PosService.checkout` Siklus 1
- Tidak ada dependency ke siklus lain (Siklus 2, 4, dst.) — modul ini berdiri sendiri di atas fondasi Siklus 1 saja.
