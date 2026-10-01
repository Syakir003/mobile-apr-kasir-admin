# AC Indoor/Outdoor Berpasangan (Point 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biarin toko jual & catat AC yang komponennya 2 Product terpisah (Indoor & Outdoor) sebagai 1 aksi pas Barang Masuk / POS ("Unit Lengkap"), sambil Indoor & Outdoor TETAP 2 Product independen (stok/harga sendiri-sendiri, tetap bisa dijual/diganti terpisah).

**Architecture:** Indoor & Outdoor tetap `Product` terpisah. `Product.pairedProductId` (Indoor→Outdoor, one-directional) cuma buat auto-suggest UI. Barang Masuk & POS dapet toggle "Sekalian Outdoor-nya (Unit Lengkap)" yang HANYA muncul kalau produk yang dipilih itu Indoor ber-pair — nyalain toggle ini bikin SATU aksi (1 barang-masuk / 1 baris keranjang) sebenarnya proses DUA `Product` sekaligus: modal/harga nempel ke Indoor, sisi Outdoor otomatis `buyPrice`/`unitPrice` 0 (gak nambah ke total/gak pernah warning modal). Stok abis di salah satu sisi bikin SELURUH aksi gagal (bawaan dari cara locking per-item yang udah ada — gak butuh kode blocking baru). `MemberAcUnit` tetap 1 barcode per unit terpasang, sekarang punya `indoorProductId`/`outdoorProductId` (FK, bukan snapshot string). `StockMovement.pairGroupId` nyamain 2 baris movement (Indoor+Outdoor) yang lahir dari 1 aksi Lengkap, buat dipakai laporan Point 4 nanti.

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend), Next.js App Router + React Query + react-hook-form + zod (frontend).

---

## Catatan Desain Kunci (baca sebelum eksekusi)

1. **"Mode" itu bukan 3 pilihan di 1 dropdown** — cuma toggle "Sekalian Outdoor-nya" yang muncul kalau produk yang lagi dipilih (di Barang Masuk / kartu POS) adalah Indoor yang punya `pairedProductId`. "Indoor saja" dan "Outdoor saja" itu ya perilaku LAMA yang udah jalan (pilih produk itu langsung, checkout/stock-in biasa) — TIDAK butuh kode baru sama sekali, cuma dijelaskan di sini biar jelas cakupannya.
2. **Barang Masuk mode Lengkap**: `refId` (field lama) SELALU Indoor, `outdoorRefId` (field baru) SELALU Outdoor. Gak ada logic nebak arah — satu-satunya entry point toggle ini adalah dari kartu/form produk Indoor (yang emang satu-satunya satu yang tampil di list Master Data top-level, lihat poin 6).
3. **POS mode Lengkap**: nambah produk Indoor ber-pair dengan toggle nyala otomatis nambahin 2 baris keranjang (Indoor + Outdoor) yang KETAUTAN (`pairGroupKey` di sisi frontend) — qty & hapus jalan bareng, harga Outdoor dikunci gak bisa diedit, terus dikirim ke server pakai `CheckoutItemDto.pairedWithItemIndex` (di baris Outdoor, nunjuk index baris Indoor).
4. **Blocking stok kalau salah satu sisi abis**: TIDAK butuh kode baru. `PosService.checkout`/`StockService.stockIn` udah jalan di dalam SATU `$transaction` — begitu SALAH SATU `lockAndDeduct`/create batch gagal (exception), semuanya rollback otomatis, checkout GAGAL total. Pesan errornya otomatis nyebut nama produk yang abis (`StockLockingService` udah gitu) — dan karena Indoor & Outdoor punya `name` masing-masing, itu udah "jelas sisi mana yang abis" sesuai requirement spec.
5. **`itemIndex` → `itemIndexes`** di `CheckoutInstallationDto` itu BREAKING CHANGE — konvensi urutan: index ke-0 = Indoor (atau produk tunggal), index ke-1 (kalau ada) = Outdoor. `AcUnitsService.createForInstallation` sekarang nerima ARRAY produk (1 atau 2 elemen), bukan 1 produk.
6. **Tampilan Master Data Produk**: produk yang jadi TARGET `pairedProductId` produk lain (= dia "Outdoor"-nya orang) di-collapse/nested di bawah baris Indoor-nya, bukan tampil sebagai baris sendiri di list utama — persis pola "gulungan aktif" nested di Point 3. Tetap full Product independen (nyari/checkout/stock-in dia langsung tetap bisa, cuma gak nongol di list utama).
7. **Scope EXPLICITLY DILUAR plan ini** (per spec 2026-09-22 + klarifikasi 2026-09-23): ganti/update outdoor pada `MemberAcUnit` yang UDAH ADA (bukan unit baru) — itu edit manual lewat halaman Unit AC yang udah ada. Walk-in intake (`ServiceOrdersService.intake` → `AcUnitsService.registerExisting`) TIDAK disentuh sama sekali plan ini — kolom `indoorProductId`/`outdoorProductId` cuma keisi dari alur POS/Barang Masuk yang beli `Product` sungguhan, bukan dari form manual walk-in (yang gak ada `Product` yang dibeli).

---

## File yang kesentuh

**Backend:**
- Modify: `prisma/schema.prisma`
- Modify: `src/products/dto/create-product.dto.ts`
- Modify: `src/products/dto/update-product.dto.ts`
- Modify: `src/products/products.service.ts`
- Create: `src/ac-units/ac-unit-pair.util.ts`
- Test: `src/ac-units/ac-unit-pair.util.spec.ts`
- Modify: `src/ac-units/ac-units.service.ts`
- Modify: `src/pos/dto/checkout.dto.ts`
- Modify: `src/pos/pos.service.ts`
- Modify: `src/stock/dto/stock-in.dto.ts`
- Modify: `src/stock/stock.service.ts`
- Test: `src/pos/dto/checkout.dto.spec.ts` (baru)
- Test: `src/stock/dto/stock-in.dto.spec.ts` (baru)

**Frontend:**
- Modify: `src/app/(dashboard)/master/produk/page.tsx`
- Modify: `src/app/(dashboard)/stock/stock-client.tsx`
- Modify: `src/app/(dashboard)/pos/page.tsx`

---

### Task 1: Migrasi skema — `pairedProductId`, `indoorProductId`/`outdoorProductId`, `pairGroupId`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Tambah field & relasi ke model `Product`**

Di `prisma/schema.prisma`, cari model `Product` (`@@map("products")`). Tambahkan sebelum `@@map("products")`:

```prisma
  // BARU (Point 2, 2026-09-23) — AC Indoor/Outdoor Berpasangan. Diisi HANYA
  // di sisi Indoor, nunjuk ke Product Outdoor pasangannya. One-directional
  // (Outdoor gak punya pairedProductId balik) — dipakai buat auto-suggest
  // toggle "Sekalian Outdoor-nya" pas Barang Masuk/POS, SELALU bisa
  // di-override manual pas transaksi (bukan validasi keras).
  pairedProductId String?   @map("paired_product_id")
  pairedProduct   Product?  @relation("ProductPairing", fields: [pairedProductId], references: [id])
  pairedWithMe    Product[] @relation("ProductPairing")

  indoorForUnits  MemberAcUnit[] @relation("AcUnitIndoorProduct")
  outdoorForUnits MemberAcUnit[] @relation("AcUnitOutdoorProduct")
```

- [ ] **Step 2: Tambah field & relasi ke model `MemberAcUnit`**

Cari model `MemberAcUnit`. Tambahkan setelah baris `serviceIntervalDays`:

```prisma
  // BARU (Point 2, 2026-09-23) — referensi Product asal Indoor/Outdoor unit
  // ini (BUKAN snapshot string), diisi otomatis dari POS/Barang Masuk mode
  // "Unit Lengkap". Nullable & independen: unit tunggal/Indoor-saja/
  // Outdoor-saja cuma isi SATU (atau NOL) dari dua, mode Lengkap isi
  // dua-duanya. Unit LAMA (sebelum kolom ini ada) tetap null dua-duanya —
  // TIDAK di-backfill (di luar scope, lihat catatan desain plan ini).
  indoorProductId  String?  @map("indoor_product_id")
  indoorProduct    Product? @relation("AcUnitIndoorProduct", fields: [indoorProductId], references: [id])
  outdoorProductId String?  @map("outdoor_product_id")
  outdoorProduct   Product? @relation("AcUnitOutdoorProduct", fields: [outdoorProductId], references: [id])
```

- [ ] **Step 3: Tambah field ke model `StockMovement`**

Cari model `StockMovement`. Tambahkan setelah baris `itemCostId`:

```prisma
  // BARU (Point 2, 2026-09-23) — disamain nilainya di 2 baris StockMovement
  // (Indoor & Outdoor) yang lahir dari SATU aksi "Unit Lengkap" (barang
  // masuk ATAU penjualan). Null di semua baris lain. Dipakai Point 4
  // (laporan stok) buat gabung 2 baris ini jadi 1 baris "Unit [nama
  // pasangan]" — TIDAK dipakai logic Point 2 sendiri selain nulis nilainya.
  pairGroupId   String?  @map("pair_group_id")
```

- [ ] **Step 4: Generate & jalanin migrasi**

Run: `npx prisma migrate dev --name point2_ac_indoor_outdoor_pairing`
Expected: migrasi baru kebuat di `prisma/migrations/`, `npx prisma generate` otomatis jalan, tipe `Prisma.ProductGetPayload`/dst update.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): tambah kolom pairing AC Indoor/Outdoor (Point 2)"
```

---

### Task 2: `pairedProductId` di Create/Update Product DTO + service

**Files:**
- Modify: `src/products/dto/create-product.dto.ts`
- Modify: `src/products/dto/update-product.dto.ts`
- Modify: `src/products/products.service.ts`
- Test: `src/products/products.service.spec.ts` (baru)

- [ ] **Step 1: Tulis test validasi DTO (gagal dulu)**

Buat file `src/products/products.service.spec.ts`:

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('ProductsService — pairedProductId (Point 2)', () => {
  function makeService(overrides: {
    findUniqueImpl?: (args: any) => any;
  } = {}) {
    const product = {
      findUnique: jest.fn(overrides.findUniqueImpl ?? (() => ({ id: 'outdoor-1' }))),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      create: jest.fn((args: any) => ({ id: 'new-id', ...args.data })),
    };
    const prisma: any = {
      product,
      auditLog: { create: jest.fn() },
      $transaction: (fn: any) => fn(prisma),
    };
    const counters: any = { nextSeq: jest.fn(async () => 1) };
    return { service: new ProductsService(prisma, counters), prisma };
  }

  it('update() nolak pairedProductId yang gak ada produknya', async () => {
    const { service } = makeService({ findUniqueImpl: (args: any) => (args.where?.id === 'x' ? { id: 'x' } : null) });
    await expect(
      service.update('x', { pairedProductId: 'ghost-id' } as any, 'actor-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update() terima pairedProductId yang valid', async () => {
    const { service, prisma } = makeService({
      findUniqueImpl: (args: any) =>
        args.where?.id === 'indoor-1' ? { id: 'indoor-1' } : { id: 'outdoor-1' },
    });
    const result = await service.update('indoor-1', { pairedProductId: 'outdoor-1' } as any, 'actor-1');
    expect(result).toMatchObject({ pairedProductId: 'outdoor-1' });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pairedProductId: 'outdoor-1' }) }),
    );
  });
});
```

- [ ] **Step 2: Jalanin test, pastikan gagal**

Run: `npx jest src/products/products.service.spec.ts`
Expected: FAIL — `ProductsService` belum validasi `pairedProductId` sama sekali (constructor beda arity dari yang dipakai test kalau perlu disesuaikan; kalau gagal karena signature, itu petunjuk buat Step 3 di bawah biar tetap kompatibel).

- [ ] **Step 3: Tambah field ke `CreateProductDto`**

Di `src/products/dto/create-product.dto.ts`, tambahkan di akhir class (sebelum `}`):

```typescript
  // BARU (Point 2, 2026-09-23) — id Product Outdoor pasangan (kalau produk
  // ini Indoor-nya sebuah unit AC 2-komponen). Opsional — mayoritas produk
  // (sparepart-terpisah, produk non-AC) gak butuh ini sama sekali.
  @IsOptional() @IsString() pairedProductId?: string;
```

- [ ] **Step 4: Tambah field ke `UpdateProductDto`**

Di `src/products/dto/update-product.dto.ts`, tambahkan sebelum `active?: boolean`:

```typescript
  @IsOptional() @IsString() pairedProductId?: string;
```

- [ ] **Step 5: Validasi + pass-through di `ProductsService`**

Di `src/products/products.service.ts`, tambah helper privat dan pakai di `create()`/`update()`:

```typescript
  private async assertPairedProductValid(pairedProductId: string | undefined, selfId?: string) {
    if (pairedProductId === undefined) return;
    if (pairedProductId === selfId) {
      throw new BadRequestException('Produk gak bisa dipasangkan ke dirinya sendiri');
    }
    const pair = await this.prisma.product.findUnique({ where: { id: pairedProductId } });
    if (!pair) throw new BadRequestException(`Produk pasangan ${pairedProductId} tidak ditemukan`);
  }
```

Ubah `create()`:

```typescript
  create(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertPairedProductValid(dto.pairedProductId);
      const seq = await this.counters.nextSeq(tx, 'product_sku');
      const sku = `PRD-${String(seq).padStart(4, '0')}`;
      return tx.product.create({ data: { ...dto, sku, active: true } });
    });
  }
```

Ubah awal `update()` (setelah cek `existing`):

```typescript
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Produk tidak ditemukan');
    await this.assertPairedProductValid(dto.pairedProductId, id);

    const product = await this.prisma.product.update({ where: { id }, data: dto });
```

- [ ] **Step 6: `findAll`/`findOne` sertakan info pasangan (buat tampilan nested frontend)**

Ubah `findAll()`:

```typescript
  async findAll() {
    const products = await this.prisma.product.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: { pairedProduct: { select: { id: true, name: true } } },
    });
    const stockMap = await this.stockFor(products.map((p) => p.id));
    return products.map((p) => ({ ...p, stock: stockMap.get(p.id) ?? 0 }));
  }
```

Ubah `findOne()`:

```typescript
  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { pairedProduct: { select: { id: true, name: true } } },
    });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');
    const stockMap = await this.stockFor([id]);
    return { ...product, stock: stockMap.get(id) ?? 0 };
  }
```

- [ ] **Step 7: Jalanin test, pastikan lolos**

Run: `npx jest src/products/products.service.spec.ts`
Expected: PASS (2/2)

- [ ] **Step 8: Commit**

```bash
git add src/products
git commit -m "feat(products): dukung pairedProductId (Indoor→Outdoor) di create/update/findAll"
```

---

### Task 3: `AcUnitsService.createForInstallation` — dukung 1 atau 2 produk (Indoor+Outdoor)

**Files:**
- Create: `src/ac-units/ac-unit-pair.util.ts`
- Test: `src/ac-units/ac-unit-pair.util.spec.ts`
- Modify: `src/ac-units/ac-units.service.ts`

- [ ] **Step 1: Tulis test util murni (gagal dulu)**

Buat `src/ac-units/ac-unit-pair.util.spec.ts`:

```typescript
import { resolveAcUnitPairFields, PairableProduct } from './ac-unit-pair.util';

const indoor: PairableProduct = { id: 'indoor-1', brand: 'Panasonic', type: 'Split Indoor', pk: 1 as any };
const outdoor: PairableProduct = { id: 'outdoor-1', brand: 'Panasonic', type: 'Split Outdoor', pk: 1 as any };
const standalone: PairableProduct = { id: 'std-1', brand: 'LG', type: 'Standing', pk: 2 as any };

describe('resolveAcUnitPairFields', () => {
  it('1 produk tanpa pairedProductId -> indoorProductId/outdoorProductId null dua-duanya', () => {
    const r = resolveAcUnitPairFields([standalone]);
    expect(r.indoorProductId).toBeNull();
    expect(r.outdoorProductId).toBeNull();
    expect(r.brand).toBe('LG');
    expect(r.model).toBe('Standing');
  });

  it('1 produk YANG punya pairedProductId -> dianggap Indoor-nya', () => {
    const r = resolveAcUnitPairFields([{ ...indoor, pairedProductId: outdoor.id }]);
    expect(r.indoorProductId).toBe('indoor-1');
    expect(r.outdoorProductId).toBeNull();
  });

  it('2 produk -> [0]=Indoor, [1]=Outdoor, model digabung', () => {
    const r = resolveAcUnitPairFields([indoor, outdoor]);
    expect(r.indoorProductId).toBe('indoor-1');
    expect(r.outdoorProductId).toBe('outdoor-1');
    expect(r.brand).toBe('Panasonic');
    expect(r.model).toBe('Split Indoor + Split Outdoor');
    expect(r.pk).toBe(1);
  });

  it('lebih dari 2 produk -> lempar error', () => {
    expect(() => resolveAcUnitPairFields([indoor, outdoor, standalone])).toThrow();
  });

  it('array kosong -> lempar error', () => {
    expect(() => resolveAcUnitPairFields([])).toThrow();
  });
});
```

- [ ] **Step 2: Jalanin test, pastikan gagal**

Run: `npx jest src/ac-units/ac-unit-pair.util.spec.ts`
Expected: FAIL — `Cannot find module './ac-unit-pair.util'`

- [ ] **Step 3: Implementasi util**

Buat `src/ac-units/ac-unit-pair.util.ts`:

```typescript
import { Prisma } from '@prisma/client';

/** Field minimal dari Product yang dibutuhkan buat resolve data MemberAcUnit. */
export interface PairableProduct {
  id: string;
  brand?: string | null;
  type?: string | null;
  pk?: Prisma.Decimal | number | null;
  pairedProductId?: string | null;
}

export interface AcUnitPairFields {
  indoorProductId: string | null;
  outdoorProductId: string | null;
  brand: string | null;
  model: string | null;
  pk: Prisma.Decimal | number | null;
}

/**
 * Nentuin indoorProductId/outdoorProductId + brand/model/pk gabungan buat
 * MemberAcUnit, dari 1-2 Product yang lagi diinstal dalam SATU aksi.
 *
 * Konvensi urutan (Point 2, 2026-09-23): kalau `products` panjangnya 2,
 * elemen ke-0 SELALU Indoor dan ke-1 SELALU Outdoor — ini dijamin oleh
 * PEMANGGIL (PosService.checkout, lewat urutan itemIndexes) bukan ditebak
 * di sini. Kalau cuma 1 elemen: dianggap Indoor HANYA kalau dia sendiri
 * punya `pairedProductId` (produk yang dikonfigurasi sebagai sisi Indoor
 * sebuah pasangan) — selain itu (produk non-AC/gak ber-pair, atau Outdoor
 * yang dijual berdiri sendiri) dua-duanya null, sama seperti perilaku
 * sebelum kolom ini ada.
 */
export function resolveAcUnitPairFields(products: PairableProduct[]): AcUnitPairFields {
  if (products.length === 0 || products.length > 2) {
    throw new Error('resolveAcUnitPairFields butuh 1 atau 2 produk');
  }

  const [first, second] = products;
  const brand = first.brand ?? second?.brand ?? null;
  const model =
    products.length === 2
      ? [first.type, second.type].filter(Boolean).join(' + ') || null
      : (first.type ?? null);
  const pk = first.pk ?? second?.pk ?? null;

  if (products.length === 2) {
    return { indoorProductId: first.id, outdoorProductId: second.id, brand, model, pk };
  }

  const isIndoor = !!first.pairedProductId;
  return {
    indoorProductId: isIndoor ? first.id : null,
    outdoorProductId: null,
    brand,
    model,
    pk,
  };
}
```

- [ ] **Step 4: Jalanin test, pastikan lolos**

Run: `npx jest src/ac-units/ac-unit-pair.util.spec.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Ganti signature `createForInstallation`**

Di `src/ac-units/ac-units.service.ts`, tambah import di atas:

```typescript
import { resolveAcUnitPairFields, PairableProduct } from './ac-unit-pair.util';
```

Ganti seluruh method `createForInstallation`:

```typescript
  /**
   * `products`: 1 elemen (unit tunggal, atau Indoor/Outdoor dijual berdiri
   * sendiri) atau 2 elemen ([0]=Indoor, [1]=Outdoor — Point 2, mode "Unit
   * Lengkap"). SATU MemberAcUnit + SATU barcode lahir dari panggilan ini,
   * berapapun jumlah produknya — sesuai keputusan lama: 1 unit terpasang =
   * 1 barcode, walau komponennya 2 Product.
   */
  async createForInstallation(
    tx: Prisma.TransactionClient,
    memberId: string,
    products: PairableProduct[],
    roomLocation?: string,
  ) {
    const now = new Date();
    const seq = await this.counters.nextSeq(tx, `acunit_${this.counters.dateKey(now)}`);
    const barcodeValue = this.formatBarcode(now, seq);
    const fields = resolveAcUnitPairFields(products);

    return tx.memberAcUnit.create({
      data: {
        memberId,
        brand: fields.brand,
        model: fields.model,
        pk: fields.pk == null ? null : new Prisma.Decimal(fields.pk as any),
        roomLocation: roomLocation ?? null,
        barcodeValue,
        status: 'menunggu_pemasangan',
        indoorProductId: fields.indoorProductId,
        outdoorProductId: fields.outdoorProductId,
      },
    });
  }
```

- [ ] **Step 6: Commit**

```bash
git add src/ac-units
git commit -m "feat(ac-units): createForInstallation dukung pasangan Indoor+Outdoor"
```

---

### Task 4: `CheckoutInstallationDto.itemIndexes` + `CheckoutItemDto.pairedWithItemIndex`

**Files:**
- Modify: `src/pos/dto/checkout.dto.ts`
- Test: `src/pos/dto/checkout.dto.spec.ts` (baru)

- [ ] **Step 1: Tulis test validasi DTO (gagal dulu)**

Buat `src/pos/dto/checkout.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CheckoutInstallationDto, CheckoutItemDto } from './checkout.dto';

describe('CheckoutInstallationDto.itemIndexes (Point 2)', () => {
  it('nolak array kosong', async () => {
    const dto = plainToInstance(CheckoutInstallationDto, { itemIndexes: [] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('terima 1 index (unit tunggal)', async () => {
    const dto = plainToInstance(CheckoutInstallationDto, { itemIndexes: [0] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('terima 2 index (mode Lengkap: [indoor, outdoor])', async () => {
    const dto = plainToInstance(CheckoutInstallationDto, { itemIndexes: [0, 1] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('CheckoutItemDto.pairedWithItemIndex (Point 2)', () => {
  it('opsional — item tanpa ini tetap valid', async () => {
    const dto = plainToInstance(CheckoutItemDto, { kind: 'product', refId: 'p1', qty: 1 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('kalau diisi harus integer >= 0', async () => {
    const dto = plainToInstance(CheckoutItemDto, {
      kind: 'product',
      refId: 'p1',
      qty: 1,
      pairedWithItemIndex: -1,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Jalanin test, pastikan gagal**

Run: `npx jest src/pos/dto/checkout.dto.spec.ts`
Expected: FAIL — `itemIndex` masih wajib tunggal, `pairedWithItemIndex` belum ada properti-nya (whitelist/validate error atau TS compile error tergantung setup — intinya belum sesuai bentuk baru).

- [ ] **Step 3: Ubah `CheckoutItemDto`**

Di `src/pos/dto/checkout.dto.ts`, tambah di akhir `CheckoutItemDto` (sebelum `}`):

```typescript
  // BARU (Point 2, 2026-09-23) — nunjuk index item PASANGAN (Indoor)-nya di
  // array `items` ini, HANYA diisi di baris Outdoor pas mode "Unit Lengkap".
  // Efeknya di server: harga efektif baris ini DIPAKSA 0 (gak nambah ke
  // total, gak pernah kena warning "di bawah modal"), dan StockMovement
  // baris ini + baris pasangannya dikasih `pairGroupId` yang SAMA. Stok
  // salah satu sisi abis otomatis bikin SELURUH checkout gagal (bawaan
  // locking per-item yang udah ada, lihat PosService.checkout).
  @IsOptional() @IsInt() @Min(0) pairedWithItemIndex?: number;
```

- [ ] **Step 4: Ganti `itemIndex` jadi `itemIndexes` di `CheckoutInstallationDto`**

Ganti:

```typescript
export class CheckoutInstallationDto {
  @IsInt() @Min(0) itemIndex: number;
```

Jadi:

```typescript
export class CheckoutInstallationDto {
  // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) — BREAKING
  // CHANGE dari `itemIndex: number` tunggal. 1 elemen = unit biasa/Indoor-
  // saja/Outdoor-saja (perilaku lama, cuma dibungkus array). 2 elemen =
  // mode "Unit Lengkap": index ke-0 WAJIB Indoor, index ke-1 WAJIB Outdoor
  // (konvensi urutan, bukan ditebak server — lihat resolveAcUnitPairFields).
  // SEMUA index di sini jadi SATU MemberAcUnit + SATU barcode.
  @IsInt({ each: true }) @Min(0, { each: true }) @ArrayMinSize(1) itemIndexes: number[];
```

- [ ] **Step 5: Jalanin test, pastikan lolos**

Run: `npx jest src/pos/dto/checkout.dto.spec.ts`
Expected: PASS (5/5)

- [ ] **Step 6: Commit**

```bash
git add src/pos/dto/checkout.dto.ts src/pos/dto/checkout.dto.spec.ts
git commit -m "feat(pos): CheckoutDto dukung itemIndexes[] + pairedWithItemIndex (Point 2)"
```

---

### Task 5: `PosService.checkout` — proses pairing (harga 0, pairGroupId, install 1-2 produk)

**Files:**
- Modify: `src/pos/pos.service.ts`

Task ini murni service Prisma-transaction-heavy — gak ada harness mocking Prisma di repo ini (lihat `stock-locking.service.spec.ts`/`pos-calc.util.spec.ts`, dua-duanya cuma test fungsi murni). Makanya verifikasinya lewat **manual smoke test ke dev server** (Step 4), bukan Jest — konsisten sama cara `checkout()` yang existing (below-cost warning, FIFO batch split, dst) juga gak punya spec file sendiri.

- [ ] **Step 1: Force harga 0 buat baris Outdoor berpasangan**

Di `src/pos/pos.service.ts`, cari blok `priced.set` buat `kind === 'product'` (sekitar baris 154-157):

```typescript
          } else if (item.kind === 'product') {
            const locked = stockResults.get(lineKey(item))!;
            const unitPrice = item.unitPriceOverride ?? locked.unitPrice;
            priced.set(lineKey(item), { name: locked.name, unit: locked.unit, unitPrice, buyPriceSnapshot: locked.buyPrice });
```

Ganti jadi:

```typescript
          } else if (item.kind === 'product') {
            const locked = stockResults.get(lineKey(item))!;
            // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) —
            // baris Outdoor mode "Unit Lengkap" (pairedWithItemIndex keisi)
            // harganya DIPAKSA 0, gak peduli unitPriceOverride yang kekirim
            // (modal/harga jual sepenuhnya nempel ke sisi Indoor).
            const unitPrice =
              item.pairedWithItemIndex !== undefined ? 0 : (item.unitPriceOverride ?? locked.unitPrice);
            priced.set(lineKey(item), { name: locked.name, unit: locked.unit, unitPrice, buyPriceSnapshot: locked.buyPrice });
```

- [ ] **Step 2: Skip cek "di bawah modal" buat baris Outdoor berpasangan**

Cari loop below-cost (sekitar baris 229-267), baris pertama di dalam loop:

```typescript
        for (const item of dto.items) {
          if (item.kind !== 'product') continue;
          const p = priced.get(lineKey(item))!;
```

Ganti jadi:

```typescript
        for (const item of dto.items) {
          if (item.kind !== 'product') continue;
          // Outdoor mode "Unit Lengkap" harganya udah dipaksa 0 di atas —
          // gak mungkin "untung" dan gak relevan dibanding modal, jadi
          // SELALU dilewatin dari warning ini (sesuai spec: Outdoor gak
          // pernah kena warning modal).
          if (item.pairedWithItemIndex !== undefined) continue;
          const p = priced.get(lineKey(item))!;
```

- [ ] **Step 3: Generate `pairGroupId` & pasang ke StockMovement pasangan Indoor+Outdoor**

Cari loop pembuatan `TransactionItem`/`StockMovement` per item (sekitar baris 327-390). Tepat SEBELUM loop `for (const item of dto.items) { const p = priced.get(...)` yang bikin `TransactionItem`, tambahkan penyiapan map `pairGroupId`:

```typescript
        // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) — 1
        // pairGroupId per PASANGAN (dikunci dari index baris Outdoor-nya,
        // karena cuma Outdoor yang bawa pairedWithItemIndex), dipasang ke
        // StockMovement baris Indoor MAUPUN Outdoor yang bersangkutan.
        const pairGroupIdByItemIndex = new Map<number, string>();
        dto.items.forEach((item, idx) => {
          if (item.pairedWithItemIndex === undefined) return;
          const groupId = randomUUID();
          pairGroupIdByItemIndex.set(idx, groupId);
          pairGroupIdByItemIndex.set(item.pairedWithItemIndex, groupId);
        });
```

Lalu di loop `for (const item of dto.items)` yang bikin `StockMovement` (yang punya cabang `if (splits && splits.length > 0) { ... } else { ... }`), tambahkan `pairGroupId` ke KEDUA cabang `tx.stockMovement.create` data. Cabang pertama:

```typescript
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
                    pairGroupId: pairGroupIdByItemIndex.get(dto.items.indexOf(item)) ?? null,
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
                  pairGroupId: pairGroupIdByItemIndex.get(dto.items.indexOf(item)) ?? null,
                },
              });
            }
```

Catatan: `dto.items.indexOf(item)` aman di sini karena `item` adalah referensi objek yang sama persis dari `dto.items` (loop `for...of` langsung di atas array itu), bukan copy.

Tambahkan `import { randomUUID } from 'crypto';` di paling atas file, konsisten sama gaya import Node builtin yang dipakai Task 7 di `stock.service.ts`.

- [ ] **Step 4: Ganti loop instalasi buat pakai `itemIndexes[]` + `createForInstallation([...])`**

Ganti seluruh blok instalasi (baris ~516-545):

```typescript
        let serviceOrderId: string | null = null;
        const installedUnits: { unitId: string; barcodeValue: string; roomLocation: string | null }[] = [];
        if (dto.installations?.length) {
          const order = await tx.serviceOrder.create({
            data: { memberId: member.id, transactionId: transaction.id, invoiceId: invoice.id, type: 'pemasangan', status: 'terjadwal', createdById: actorId },
          });
          serviceOrderId = order.id;

          for (let idx = 0; idx < dto.installations.length; idx++) {
            const inst = dto.installations[idx];
            if (inst.itemIndexes.length > 2) {
              throw new BadRequestException('itemIndexes instalasi maksimal 2 (Indoor + Outdoor)');
            }
            const products = [];
            for (const itemIdx of inst.itemIndexes) {
              const item = dto.items[itemIdx];
              if (!item || item.kind !== 'product') {
                throw new BadRequestException('itemIndexes instalasi harus menunjuk item bertipe product');
              }
              const productData = await tx.product.findUnique({ where: { id: item.refId } });
              if (!productData) throw new BadRequestException(`Produk ${item.refId} tidak ditemukan saat proses instalasi`);
              products.push(productData);
            }
            const unit = await this.acUnits.createForInstallation(tx, member.id, products, inst.roomLocation);
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
```

- [ ] **Step 5: Manual smoke test ke dev server**

Run: `npm run start:dev` (biarin jalan di terminal terpisah), lalu (ganti `$TOKEN` dengan JWT admin/kasir valid, `$INDOOR_ID`/`$OUTDOOR_ID` dengan 2 Product yang stoknya udah diisi lewat `/stock/in`):

```bash
curl -s -X POST http://localhost:3000/pos/checkout \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "customer": {"name": "Test Pairing", "phone": "081200000000"},
    "items": [
      {"kind": "product", "refId": "'"$INDOOR_ID"'", "qty": 1, "unitPriceOverride": 3500000},
      {"kind": "product", "refId": "'"$OUTDOOR_ID"'", "qty": 1, "pairedWithItemIndex": 0}
    ],
    "installations": [{"itemIndexes": [0, 1], "roomLocation": "Ruang Tamu"}]
  }' | python3 -m json.tool
```

Expected: `status: "ok"`, `installedUnits` berisi 1 unit. Cek lewat `GET /ac-units/:id` (pakai `unitId` dari respons) — `indoorProductId`/`outdoorProductId` dua-duanya keisi. Cek `SELECT * FROM stock_movements WHERE transaction_id = '<transactionId>'` di DB — 2 baris (Indoor & Outdoor), `pair_group_id` sama persis di dua-duanya, baris Outdoor `qty_change` tetap ke-potong stoknya walau harganya (`invoice_items.unit_price`) 0.

- [ ] **Step 6: Commit**

```bash
git add src/pos/pos.service.ts
git commit -m "feat(pos): checkout proses pasangan Indoor/Outdoor (harga 0, pairGroupId, install gabungan)"
```

---

### Task 6: `StockInDto` — `pairMode` + `outdoorRefId`

**Files:**
- Modify: `src/stock/dto/stock-in.dto.ts`
- Test: `src/stock/dto/stock-in.dto.spec.ts` (baru)

- [ ] **Step 1: Tulis test validasi DTO (gagal dulu)**

Buat `src/stock/dto/stock-in.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StockInDto } from './stock-in.dto';

describe('StockInDto.pairMode/outdoorRefId (Point 2)', () => {
  it('pairMode opsional, default perilaku lama tetap valid', async () => {
    const dto = plainToInstance(StockInDto, { kind: 'product', refId: 'p1', qty: 1, buyPrice: 100 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('pairMode di luar tunggal/lengkap ditolak', async () => {
    const dto = plainToInstance(StockInDto, {
      kind: 'product', refId: 'p1', qty: 1, buyPrice: 100, pairMode: 'ngaco',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('pairMode=lengkap + outdoorRefId valid', async () => {
    const dto = plainToInstance(StockInDto, {
      kind: 'product', refId: 'indoor-1', qty: 1, buyPrice: 100,
      pairMode: 'lengkap', outdoorRefId: 'outdoor-1',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Jalanin test, pastikan gagal**

Run: `npx jest src/stock/dto/stock-in.dto.spec.ts`
Expected: FAIL — properti `pairMode`/`outdoorRefId` belum dikenal DTO (test ke-3 gak akan error karena extra property gak divalidasi ketat di sini, tapi test ke-2 GAGAL karena `pairMode` yang gak dikenal gak divalidasi sama sekali dan lolos — jadi jalanin dulu buat konfirmasi test ke-2 currently PASS-nya salah/false-negative sebelum field-nya ada; setelah Step 3 ditambahkan barulah test ke-2 jadi assersi yang valid).

- [ ] **Step 3: Tambah field**

Di `src/stock/dto/stock-in.dto.ts`, tambah di akhir class `StockInDto` (sebelum `}`):

```typescript
  // BARU (Point 2, 2026-09-23) — mode pairing AC Indoor/Outdoor. Default
  // (gak dikirim / 'tunggal') = perilaku lama persis, gak ada pairing sama
  // sekali. 'lengkap' bikin DUA batch sekaligus dalam SATU panggilan ini —
  // `refId` di atas SELALU dipakai sebagai id Product INDOOR, `outdoorRefId`
  // di bawah SELALU Outdoor-nya (gak ada logic nebak arah — satu-satunya
  // entry point toggle ini di frontend adalah dari produk Indoor, lihat
  // stock-client.tsx). Modal (`buyPrice` di atas) SELALU ke sisi Indoor;
  // Outdoor otomatis dapet buyPrice 0 (record-only, gak pernah kena warning
  // "di bawah modal").
  @IsOptional()
  @IsIn(['tunggal', 'lengkap'])
  pairMode?: 'tunggal' | 'lengkap';

  // Wajib diisi (divalidasi manual di StockService.stockIn, bukan di sini —
  // sama pola kayak requiredness qty/rolls) kalau pairMode='lengkap'.
  @IsOptional() @IsString() outdoorRefId?: string;
```

- [ ] **Step 4: Jalanin test, pastikan lolos**

Run: `npx jest src/stock/dto/stock-in.dto.spec.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add src/stock/dto/stock-in.dto.ts src/stock/dto/stock-in.dto.spec.ts
git commit -m "feat(stock): StockInDto dukung pairMode+outdoorRefId (Point 2)"
```

---

### Task 7: `StockService.stockIn` — cabang `pairMode='lengkap'` buat `kind='product'`

**Files:**
- Modify: `src/stock/stock.service.ts`

Sama seperti Task 5, ini transaction-heavy tanpa harness mocking Prisma di repo — verifikasi lewat manual smoke test (Step 3), konsisten sama cabang `kind='product'` existing yang juga gak ada spec file-nya.

- [ ] **Step 1: Tambah cabang Lengkap SEBELUM cabang `kind==='product'` tunggal**

Di `src/stock/stock.service.ts`, cari komentar `// kind === 'product' — selalu bikin batch (item_costs) BARU.` (sekitar baris 199). TEPAT SEBELUM baris itu (dan sebelum `if (dto.qty === undefined) { throw ... }` di bawahnya), sisipkan:

```typescript
        // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) —
        // cabang terpisah, gak numpuk sama alur tunggal di bawah (biar gak
        // nyampur 2 cara nulis batch yang beda banyak: 1 batch vs 2 batch,
        // 1 below-cost check vs 1 below-cost check + 1 yang di-skip).
        if (dto.kind === 'product' && dto.pairMode === 'lengkap') {
          if (dto.qty === undefined) throw new BadRequestException('Qty wajib diisi');
          if (!dto.outdoorRefId) {
            throw new BadRequestException('outdoorRefId wajib diisi buat mode Unit Lengkap');
          }
          const indoorProduct = await tx.product.findUnique({ where: { id: dto.refId } });
          if (!indoorProduct) throw new BadRequestException(`Produk ${dto.refId} tidak ditemukan`);
          const outdoorProduct = await tx.product.findUnique({ where: { id: dto.outdoorRefId } });
          if (!outdoorProduct) throw new BadRequestException(`Produk ${dto.outdoorRefId} tidak ditemukan`);

          const { isBelowCost, effectivePrice } = checkBelowCost({
            buyPrice: dto.buyPrice,
            sellPrice: Number(indoorProduct.sellPrice),
          });
          if (isBelowCost && !dto.confirmOverride) {
            throw new ConfirmationRequiredException([
              {
                refId: dto.refId,
                itemCostId: null,
                name: indoorProduct.name,
                buyPrice: dto.buyPrice,
                sellPrice: Number(indoorProduct.sellPrice),
                discount: 0,
                effectivePrice,
              },
            ]);
          }

          const pairGroupId = randomUUID();

          const indoorBatch = await tx.itemCost.create({
            data: { kind: 'product', refId: dto.refId, supplierName: dto.supplierName, buyPrice: dto.buyPrice, sellPrice: 0, stock: dto.qty },
          });
          await tx.stockMovement.create({
            data: { itemKind: 'product', refId: dto.refId, name: indoorProduct.name, qtyChange: dto.qty, reason: 'barang_masuk', createdById: actorId, itemCostId: indoorBatch.id, pairGroupId },
          });

          const outdoorBatch = await tx.itemCost.create({
            data: { kind: 'product', refId: dto.outdoorRefId, supplierName: dto.supplierName, buyPrice: 0, sellPrice: 0, stock: dto.qty },
          });
          await tx.stockMovement.create({
            data: { itemKind: 'product', refId: dto.outdoorRefId, name: outdoorProduct.name, qtyChange: dto.qty, reason: 'barang_masuk', createdById: actorId, itemCostId: outdoorBatch.id, pairGroupId },
          });

          await tx.auditLog.create({
            data: {
              actorUid: actorId,
              action: 'stock.in',
              target: dto.refId,
              detail: {
                kind: 'product', pairMode: 'lengkap', pairGroupId,
                indoor: { refId: dto.refId, name: indoorProduct.name, qty: dto.qty, buyPrice: dto.buyPrice, batchId: indoorBatch.id },
                outdoor: { refId: dto.outdoorRefId, name: outdoorProduct.name, qty: dto.qty, buyPrice: 0, batchId: outdoorBatch.id },
                note: dto.note ?? null,
                override: isBelowCost || undefined,
              },
            },
          });

          return {
            kind: 'product' as const,
            batchId: indoorBatch.id,
            refId: dto.refId,
            name: indoorProduct.name,
            qty: dto.qty,
            buyPrice: dto.buyPrice,
            pairGroupId,
            outdoorBatchId: outdoorBatch.id,
          };
        }

```

- [ ] **Step 2: Import `randomUUID`**

Tambah di paling atas `src/stock/stock.service.ts`:

```typescript
import { randomUUID } from 'crypto';
```

- [ ] **Step 3: Manual smoke test ke dev server**

Run: `npm run start:dev`, lalu (Indoor/Outdoor 2 Product yang udah ada, belum ada stok):

```bash
curl -s -X POST http://localhost:3000/stock/in \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"product","refId":"'"$INDOOR_ID"'","qty":5,"buyPrice":2800000,"pairMode":"lengkap","outdoorRefId":"'"$OUTDOOR_ID"'"}' \
  | python3 -m json.tool
```

Expected: `status: "ok"`, `pairGroupId` ada. Cek `GET /products/$INDOOR_ID` & `GET /products/$OUTDOOR_ID` — `stock` dua-duanya nambah 5. Cek `SELECT buy_price FROM item_costs WHERE ref_id = '$OUTDOOR_ID' ORDER BY created_at DESC LIMIT 1` — hasilnya `0`.

- [ ] **Step 4: Commit**

```bash
git add src/stock/stock.service.ts
git commit -m "feat(stock): stockIn dukung mode Lengkap (2 batch sekaligus, modal nempel Indoor)"
```

---

### Task 8: Frontend — Master Data Produk: field pasangan + tampilan nested

**Files:**
- Modify: `src/app/(dashboard)/master/produk/page.tsx`

- [ ] **Step 1: Tambah `pairedProductId`/`pairedProduct` ke tipe & form**

Di `src/app/(dashboard)/master/produk/page.tsx`, cari tipe `Product` (dari response API) dan tambahkan:

```typescript
  pairedProductId?: string | null;
  pairedProduct?: { id: string; name: string } | null;
```

Cari `ProductFormValues`/zod schema yang punya `brand`, `type`, `pk`, `sellPrice`, dan tambahkan field opsional:

```typescript
  pairedProductId: z.string().optional(),
```

Di `emptyValues`/`toFormValues`, tambahkan `pairedProductId: p.pairedProductId ?? ''` (pola sama seperti field opsional lain di form itu). Di form dialog create/edit, tambahkan sebuah `Select`/`Combobox` "Pasangan Outdoor (opsional)" yang isinya daftar semua produk AKTIF LAIN (exclude diri sendiri) — pakai query `products` yang udah ada di halaman ini (react-query), filter `p.id !== editingProduct?.id`. Pilihan "Tidak ada pasangan" mengirim `pairedProductId: undefined` (dikosongkan).

- [ ] **Step 2: Sertakan `pairedProductId` di payload create/update**

Cari mutation `createProduct`/`updateProduct` (`apiClient.post('/products', ...)` / `apiClient.patch('/products/:id', ...)`), pastikan body-nya nyertain `pairedProductId: values.pairedProductId || undefined` (kosong string jangan dikirim sebagai string kosong, biar gak nabrak `@IsString()` di DTO kalau backend nerima `''`).

- [ ] **Step 3: Tampilan nested — pisah produk "Outdoor pasangan orang" dari list utama**

Cari bagian yang nge-render tabel/list produk (row rendering, ~baris 455-464 per catatan sebelumnya). SEBELUM di-render, turunkan data jadi 2 kelompok:

```typescript
  const pairedOutdoorIds = new Set(
    products.filter((p) => p.pairedProductId).map((p) => p.pairedProductId as string),
  );
  const topLevelProducts = products.filter((p) => !pairedOutdoorIds.has(p.id));
  const outdoorByIndoorId = new Map(
    products.filter((p) => pairedOutdoorIds.has(p.id)).map((p) => [p.id, p] as const),
  );
```

Ganti sumber data yang di-`.map()` buat render baris tabel dari `products` menjadi `topLevelProducts`. Di dalam row tiap produk, kalau `p.pairedProduct` ada (dia Indoor ber-pair), render badge kecil "Berpasangan: {p.pairedProduct.name}" + baris nested collapse (pola SAMA seperti "gulungan aktif" nested di bawah baris sparepart — pakai komponen collapse/expand yang sama kalau ada, atau `<details>`/state `expandedId` kalau pola Point 3 pakai itu) yang nampilin detail produk Outdoor-nya (`outdoorByIndoorId.get(p.id)`): nama, brand, stok, harga jual — read-only, klik "Lihat/Edit produk ini" buka dialog edit produk itu sendiri (Outdoor tetap full-editable sebagai Product biasa, cuma gak nongol sebagai row sendiri di list utama).

- [ ] **Step 4: Verifikasi manual di browser**

Run: `npm run dev` di frontend, buka `/master/produk`. Buat 2 produk baru ("AC Test Indoor", "AC Test Outdoor"), edit yang Indoor, set "Pasangan Outdoor" ke yang Outdoor, save. Refresh list — pastikan "AC Test Outdoor" TIDAK muncul sebagai row terpisah, dan row "AC Test Indoor" nampilin badge + bisa expand buat liat detail Outdoor-nya.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/master/produk/page.tsx"
git commit -m "feat(master-produk): field pasangan Indoor/Outdoor + tampilan nested"
```

---

### Task 9: Frontend — Barang Masuk: toggle "Sekalian Outdoor-nya (Unit Lengkap)"

**Files:**
- Modify: `src/app/(dashboard)/stock/stock-client.tsx`

- [ ] **Step 1: Tambah `pairedProductId`/`pairedProduct` ke tipe `Product` lokal**

Di `ProductStockInTab` (`stock-client.tsx`), pastikan tipe `Product` yang dipakai di situ ikutan punya `pairedProductId?: string | null` dan `pairedProduct?: { id: string; name: string } | null` (samain sama response `/products` yang udah diubah di Task 2 Step 6).

- [ ] **Step 2: Toggle muncul kalau produk yang dipilih punya `pairedProduct`**

Di form "Tambah Batch Baru" (dalam `ProductStockInTab`), setelah field `qty`, tambahkan (cuma dirender kalau `selectedProduct?.pairedProduct` truthy):

```tsx
{selectedProduct?.pairedProduct && (
  <label className="flex items-center gap-2 text-sm">
    <Checkbox
      checked={pairLengkap}
      onCheckedChange={(v) => setPairLengkap(v === true)}
    />
    Sekalian Outdoor-nya ({selectedProduct.pairedProduct.name}) — Unit Lengkap
  </label>
)}
```

Tambahkan state `const [pairLengkap, setPairLengkap] = useState(false);` di komponen (reset ke `false` tiap kali `selectedProduct` ganti — tambahkan di `useEffect`/handler pemilihan produk yang udah ada).

- [ ] **Step 3: Sertakan `pairMode`/`outdoorRefId` di payload `/stock/in`**

Cari mutation yang POST ke `/stock/in` dalam `ProductStockInTab`. Ubah body-nya:

```typescript
        body: {
          kind: 'product',
          refId: selectedProduct.id,
          qty: Number(qty),
          buyPrice: Number(buyPrice),
          supplierName: supplierName || undefined,
          note: note || undefined,
          ...(pairLengkap && selectedProduct.pairedProduct
            ? { pairMode: 'lengkap' as const, outdoorRefId: selectedProduct.pairedProduct.id }
            : {}),
        },
```

(Sesuaikan nama variabel persis sama yang dipakai fungsi submit existing — poinnya cuma nambahin 2 field kondisional itu, jangan ubah field lain.)

- [ ] **Step 4: Pesan sukses beda buat mode Lengkap**

Di handler `onSuccess` mutation itu, kalau `pairLengkap` waktu submit true, toast sukses-nya sebut dua-duanya, mis. `` `Stok masuk: ${selectedProduct.name} + ${selectedProduct.pairedProduct?.name} (${qty} unit)` `` — kalau tidak, tetap pesan lama.

- [ ] **Step 5: Verifikasi manual di browser**

Buka `/stock`, tab Produk, pilih "AC Test Indoor" (yang udah di-pairing Task 8). Toggle "Sekalian Outdoor-nya" harus muncul & bisa dicentang. Isi qty 3, harga modal 2.800.000, submit. Cek toast sukses nyebut dua-duanya. Buka Master Data Produk — stok "AC Test Indoor" DAN "AC Test Outdoor" sama-sama nambah 3.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/stock/stock-client.tsx"
git commit -m "feat(stock-ui): toggle Unit Lengkap pas Barang Masuk produk berpasangan"
```

---

### Task 10: Frontend — POS: toggle "Sekalian Outdoor-nya" di keranjang + checkout payload

**Files:**
- Modify: `src/app/(dashboard)/pos/page.tsx`

- [ ] **Step 1: Tambah `pairedProductId`/`pairedProduct` ke interface `Product` & `CartLine`**

Ubah interface `Product`:

```typescript
interface Product {
  id: string;
  name: string;
  brand?: string;
  stock: number;
  sellPrice: number;
  pairedProductId?: string | null;
  pairedProduct?: { id: string; name: string } | null;
}
```

Ubah interface `CartLine`, tambahkan:

```typescript
  // BARU (Point 2, 2026-09-23) — cuma keisi kalau baris ini bagian dari
  // pasangan "Unit Lengkap" yang ditambahin BARENGAN (lihat addPairedProductLines).
  // Dua baris (Indoor & Outdoor) yang sama pairGroupKey-nya harus SELALU
  // punya qty sama & dihapus BARENGAN — disinkronin di setQty/removeAt.
  pairGroupKey?: string;
  pairRole?: 'indoor' | 'outdoor';
```

- [ ] **Step 2: `addProductLine` — pecah jadi 2 jalur (biasa vs Lengkap)**

Cari fungsi `addProductLine(p)`. Ganti pemanggilnya di `productCards` (`onAdd: () => addProductLine(p)`) supaya, kalau `p.pairedProduct` ada, kartu produk nampilin toggle/prompt kecil dulu ("Tambah cuma Indoor" vs "Tambah + Outdoor-nya") — cara paling simpel yang konsisten sama pola `ItemCard` yang udah ada: tambahkan 1 tombol kecil kedua di kartu KHUSUS produk yang punya `pairedProduct`, di samping tombol tambah biasa:

```typescript
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
      pairedLabel: p.pairedProduct ? `+ Sekalian ${p.pairedProduct.name}` : undefined,
      onAddPaired: p.pairedProduct ? () => addPairedProductLines(p) : undefined,
    };
  });
```

(`ItemCard` perlu dirender dengan tombol kedua kalau `pairedLabel`/`onAddPaired` ada — tambahkan prop opsional `secondaryAction?: {label: string; onClick: () => void}` ke komponen `ItemCard` dan render tombol kecil kedua kalau prop itu ada, konsisten sama styling tombol utamanya tapi variant lebih kecil/outline.)

Tambahkan fungsi baru setelah `addProductLine`:

```typescript
  function addPairedProductLines(indoorProduct: Product) {
    if (!indoorProduct.pairedProduct) return;
    const groupKey = crypto.randomUUID();
    addLine({
      kind: 'product' as const,
      refId: indoorProduct.id,
      name: indoorProduct.name,
      unit: 'unit',
      unitPrice: Number(indoorProduct.sellPrice),
      qty: 1,
      withInstallation: false,
      roomLocation: '',
      availableStock: indoorProduct.stock,
      pairGroupKey: groupKey,
      pairRole: 'indoor' as const,
    });
    addLine({
      kind: 'product' as const,
      refId: indoorProduct.pairedProduct.id,
      name: indoorProduct.pairedProduct.name,
      unit: 'unit',
      unitPrice: 0,
      qty: 1,
      withInstallation: false,
      roomLocation: '',
      pairGroupKey: groupKey,
      pairRole: 'outdoor' as const,
    });
  }
```

Catatan: `addLine` (bukan `addProductLine`) dipakai langsung di sini biar TIDAK lewat `mergeLine`-by-refId — 2 pasangan yang beda kudu selalu jadi 2 baris baru, gak boleh nge-merge ke baris lama yang kebetulan refId sama tapi beda pasangan (kasus langka tapi mending eksplisit).

- [ ] **Step 3: Sinkron qty & hapus buat baris yang ketautan `pairGroupKey`**

Cari `setQty(index, qty)`. Ubah:

```typescript
  function setQty(index: number, qty: number) {
    if (qty < 1) return;
    setLines((prev) => {
      const target = prev[index];
      if (!target) return prev;
      return prev.map((line) =>
        line === target || (target.pairGroupKey && line.pairGroupKey === target.pairGroupKey)
          ? { ...line, qty }
          : line,
      );
    });
  }
```

Cari `removeAt(index)`. Ubah:

```typescript
  function removeAt(index: number) {
    setLines((prev) => {
      const target = prev[index];
      if (!target) return prev;
      return prev.filter(
        (line) => line !== target && !(target.pairGroupKey && line.pairGroupKey === target.pairGroupKey),
      );
    });
  }
```

(Sesuaikan dengan bentuk `setLines`/state update yang PERSIS dipakai existing kalau beda dari asumsi di atas — intinya: operasi qty/hapus pada 1 baris ber-`pairGroupKey` HARUS diterapkan ke semua baris dengan `pairGroupKey` yang sama.)

- [ ] **Step 4: Harga baris Outdoor terkunci (gak bisa diedit manual) + label di kartu keranjang**

Di render keranjang, cari blok `CurrencyInput` buat edit harga per baris produk (`line.kind === 'product'`). Bungkus kondisional: kalau `line.pairRole === 'outdoor'`, tampilkan teks statis "Rp 0 (gratis, nempel ke Indoor)" alih-alih `CurrencyInput`, dan tambahkan badge kecil "Pasangan Unit Lengkap" di baris Indoor maupun Outdoor yang py `pairGroupKey`.

- [ ] **Step 5: `toggleInstallation` — nyalain instalasi di baris Indoor otomatis nyalain juga statusnya di Outdoor pasangannya (tapi cuma 1 entri instalasi yang dikirim, lihat Step 6)**

Cari `toggleInstallation(index, v)`. Kalau baris yang di-toggle punya `pairGroupKey`, terapkan `withInstallation` yang sama ke SEMUA baris ber-`pairGroupKey` itu juga (pola sinkronnya identik ke Step 3 di atas — pakai helper yang sama kalau memungkinkan, atau duplikasi pola `.map` singkat yang sama).

- [ ] **Step 6: `checkoutMutation` — bangun `items[]`/`installations[]` dengan `pairedWithItemIndex`/`itemIndexes`**

Cari pembangunan `installations` array (sekitar baris 425-441 sebelumnya):

```typescript
      const installations: { itemIndex: number; roomLocation?: string; packageId?: string }[] =
        [];
      lines.forEach((line, index) => {
        if (line.kind !== 'product' || !line.withInstallation) return;
        for (let j = 0; j < line.qty; j++) {
          installations.push({
            itemIndex: index,
            roomLocation: trimmedOrUndefined(line.roomLocation),
            packageId: line.packageId,
          });
        }
      });
```

Ganti jadi:

```typescript
      // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) —
      // itemIndex tunggal jadi itemIndexes[]. Baris Outdoor (pairRole
      // 'outdoor') TIDAK bikin entri instalasi sendiri — dia numpang di
      // entri instalasi baris Indoor pasangannya (index ke-0 = Indoor,
      // index ke-1 = Outdoor, konvensi urutan yang sama dipakai backend).
      const installations: { itemIndexes: number[]; roomLocation?: string; packageId?: string }[] =
        [];
      lines.forEach((line, index) => {
        if (line.kind !== 'product' || !line.withInstallation) return;
        if (line.pairRole === 'outdoor') return; // numpang di entri Indoor-nya
        const pairedIndex =
          line.pairGroupKey != null
            ? lines.findIndex((l) => l.pairGroupKey === line.pairGroupKey && l.pairRole === 'outdoor')
            : -1;
        const itemIndexes = pairedIndex >= 0 ? [index, pairedIndex] : [index];
        for (let j = 0; j < line.qty; j++) {
          installations.push({
            itemIndexes,
            roomLocation: trimmedOrUndefined(line.roomLocation),
            packageId: line.packageId,
          });
        }
      });
```

Cari pembangunan `items` (`items: lines.map((l) => ({...}))`). Ubah jadi:

```typescript
        items: lines.map((l, index) => ({
          kind: l.kind,
          refId: l.refId,
          qty: l.qty,
          unitPriceOverride: l.kind === 'product' ? l.unitPrice : undefined,
          pairedWithItemIndex:
            l.pairRole === 'outdoor'
              ? lines.findIndex((other) => other.pairGroupKey === l.pairGroupKey && other.pairRole === 'indoor')
              : undefined,
        })),
```

- [ ] **Step 7: Verifikasi manual di browser**

Buka `/pos`, cari "AC Test Indoor" — kartu-nya sekarang punya tombol kedua "+ Sekalian AC Test Outdoor". Klik itu — keranjang harus dapet 2 baris (Indoor harga normal, Outdoor "Rp 0"). Naikin qty Indoor jadi 2 — qty Outdoor ikut jadi 2. Hapus baris Outdoor — baris Indoor ikut kehapus. Ulangi nambah pasangan, centang "Pasang unit" di baris Indoor, isi nama+HP pelanggan, checkout. Cek respons — `installedUnits` 1 unit; `GET /ac-units/:id` nunjukin `indoorProductId`+`outdoorProductId` keisi dua-duanya; total tagihan cuma nge-charge harga Indoor doang.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/pos/page.tsx"
git commit -m "feat(pos-ui): tambah pasangan Indoor/Outdoor ke keranjang (Unit Lengkap)"
```

---

### Task 11: Sinkronin salinan lokal spec doc di repo backend

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-inventaris-lanjutan-design.md`

- [ ] **Step 1: Tempel klarifikasi 2026-09-23 ke salinan lokal**

Buka `docs/superpowers/specs/2026-09-22-inventaris-lanjutan-design.md` di repo backend. Cari section "### Keputusan" di bawah Point 2. Tambahkan paragraf yang PERSIS sama seperti yang udah ditulis ke doc Projects-tool (`specs/2026-09-22-inventaris-lanjutan-design.md`):

```markdown
**Klarifikasi 2026-09-23 (tampilan Master Data Produk):** "Sub produk" yang
diusulkan user CUMA perubahan TAMPILAN/pengelompokan di halaman Master Data
Produk, BUKAN perubahan model data. Indoor & Outdoor TETAP 2 entity `Product`
yang sepenuhnya independen (stok/harga/bisa dijual terpisah sendiri-sendiri).
Produk yang jadi target `pairedProductId` produk lain (sisi Outdoor)
di-nested/collapse di bawah baris Indoor-nya di list utama Master Data
(pola sama seperti "gulungan aktif" nested di bawah sparepart, Point 3) —
BUKAN ditampilkan sebagai baris sendiri. Outdoor TETAP full searchable/
sellable sebagai Product independen di POS/Barang Masuk (mode "Outdoor
saja") — cuma gak nongol di list utama Master Data.
```

Juga tambahkan ke bullet "File yang kesentuh" Point 2 frontend, sama seperti versi Projects-tool: tambahkan " + tampilan nested Indoor/Outdoor seperti klarifikasi di atas" setelah "Master Data Produk (field pasangan unit)".

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-09-22-inventaris-lanjutan-design.md
git commit -m "docs: sinkronin klarifikasi 2026-09-23 (tampilan nested) ke spec lokal repo"
```

---

## Self-Review (dijalanin abis semua task ditulis — checklist internal, bukan subagent)

- **Cakupan spec**: field pasangan Product (Task 1-2), toggle mode Lengkap Barang Masuk (Task 6-7, 9), toggle mode Lengkap POS + blocking stok implisit + harga Outdoor 0 (Task 4-5, 10), `MemberAcUnit.indoorProductId/outdoorProductId` FK (Task 3), `pairGroupId` (Task 1, 5, 7), tampilan nested Master Data (Task 8) — SEMUA poin spec (+ klarifikasi 2026-09-23) ke-cover. Scope walk-in intake/edit-unit-existing SENGAJA gak disentuh (di luar scope, lihat Catatan Desain #7).
- **No placeholder**: semua step punya kode literal, gak ada "TODO"/"tambahin validasi yang sesuai".
- **Konsistensi tipe**: `PairableProduct` (Task 3) dipakai konsisten di `ac-units.service.ts`; `itemIndexes`/`pairedWithItemIndex` namanya sama persis di DTO (Task 4), service (Task 5), dan frontend payload (Task 10); `pairMode`/`outdoorRefId` sama persis di DTO (Task 6), service (Task 7), frontend (Task 9).
- **Urutan task**: schema (1) → backend DTO/service dari yang paling gak bergantung ke yang paling bergantung (2→3→4→5→6→7) → frontend (8→9→10) → docs sync (11). Task 5 & 10 saling bergantung (payload frontend harus cocok bentuk DTO Task 4) — dikerjain berurutan, BUKAN paralel.

---

## Langkah manual WAJIB setelah eksekusi (DB berubah)

1. `npx prisma generate` (biasanya udah otomatis kejalan pas `migrate dev` di Task 1, tapi pastiin ulang kalau migrate sempat dijalanin manual/terpisah).
2. `npx prisma migrate deploy` di environment lain (staging/production) yang belum kena `migrate dev`.
3. `npm run build` (backend) — pastiin gak ada TS error dari perubahan tipe `createForInstallation`/DTO.
4. `npx jest` (backend) — full suite, pastiin gak ada regresi di test yang udah ada (`stock-locking.service.spec.ts`, `pos-calc.util.spec.ts`, dll).
5. Isi `Product.pairedProductId` buat pasangan AC yang UDAH ADA di Master Data (data lama gak otomatis ke-pairing — field ini baru mulai kepakai dari produk yang di-edit/dibuat baru setelah fitur ini live).
