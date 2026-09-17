# E-POS AC — Implementation Plan: Siklus 6 — Voucher & Diskon Campaign (Backend NestJS)

**Goal:** Admin bisa bikin campaign voucher dan menawarkannya ke member tertentu (bukan broadcast massal), sistem otomatis nolak nawarin voucher "pembelian AC pertama kali per kategori" ke member yang udah pernah beli kategori itu, Kasir bisa liat voucher yang bisa dipakai member pas mulai checkout, dan checkout (Siklus 1) bisa nerima 1 voucher buat motong harga — digabung sama diskon ad-hoc yang udah ada.

**Architecture:** Ini BUKAN modul berdiri sendiri. Modul baru `src/vouchers/` cuma nyediain CRUD campaign + offer + query. Bagian intinya justru **memodifikasi** `CheckoutDto` dan `PosService.checkout()` yang udah jadi di Siklus 1 — voucher divalidasi & dipakai di dalam Prisma transaction checkout yang sama, pakai pola row-locking yang sama kayak `StockLockingService` (Task 4.1 Siklus 1), supaya 1 voucher gak bisa kepake 2x kalau ada 2 device checkout barengan.

**Tech Stack:** NestJS + TypeScript, Prisma + PostgreSQL, `class-validator`. Tabel `voucher_campaigns` & `voucher_claims` **sudah ada** di schema (hasil `prisma db pull` Task 0.1 Siklus 1) — gak ada migration baru di plan ini.

---

## Ruang lingkup siklus ini

**Termasuk:**
- `POST /vouchers/campaigns` (admin) — bikin campaign.
- `POST /vouchers/campaigns/:id/offer` (admin) — tawarin campaign ke list member tertentu, dengan skip otomatis kalau member gak eligible (`firstPurchaseOnly`) atau udah pernah ditawarkan.
- Logic `isEligibleFirstPurchase(memberId, category)` — deteksi riwayat pembelian kategori tertentu.
- `GET /vouchers/my-claims?memberId=` (kasir) — voucher yang bisa dipakai member pas checkout.
- Modifikasi `CheckoutDto` + `PosService.checkout()` (Siklus 1) — terima & terapkan `voucherClaimId`.

**Sengaja di luar scope siklus ini:**
- Endpoint update/nonaktifkan campaign, endpoint hapus claim — gak diminta requirement, skala 1 toko 2 orang gak butuh CRUD penuh dulu. Kalau admin salah bikin campaign, cukup `active=false` manual lewat Prisma Studio buat sementara (tambahin `PATCH` kalau beneran kepake nanti).
- Endpoint "customer klaim sendiri voucher" (self-service claim, ubah status `ditawarkan`→`diklaim`) — requirement cuma bilang "menawarkan", checkout ini didesain bisa langsung pakai status `ditawarkan` ATAU `diklaim` (lihat Task 5.2), jadi gak nge-block alur kalau fitur klaim mandiri belum ada.
- Notifikasi WA otomatis pas voucher ditawarkan — reuse `NotificationsService` (Siklus 1 Fase 7) gampang ditambah belakangan, tapi gak diminta eksplisit di sini jadi di-skip biar plan gak melebar.
- Broadcast massal ke semua member — requirement eksplisit bilang bukan itu, jadi endpoint offer wajib terima list `memberIds` spesifik, gak ada mode "semua member".

## Keputusan desain

1. **Diskon ad-hoc + diskon voucher DIGABUNG dijumlah, bukan pilih salah satu.** Ini **ASUMSI yang perlu dikonfirmasi ke tim/product owner**, bukan keputusan final — soalnya ini keputusan bisnis (boleh gak sih 1 transaksi dapet diskon manual dari admin SEKALIGUS potongan voucher?), bukan keputusan teknis murni. Plan ini implementasi jalan tengah paling aman secara kode (gampang dipisah lagi kalau ternyata product owner maunya "pilih salah satu, yang lebih gede yang jalan" atau "voucher gak boleh numpuk sama diskon manual") — variable `totalDiscount = (dto.discount ?? 0) + voucherDiscountAmount` gampang diganti jadi `Math.max(...)` kalau keputusannya beda. **Tindak lanjut: konfirmasi ke PO sebelum deploy ke production**, gampang salah kalau dibiarin asumsi kode doang.
2. **Potongan persentase voucher dihitung dari subtotal SEBELUM dikurangi diskon apapun** (bukan dari subtotal setelah dipotong diskon ad-hoc) — biar dua sumber diskon independen satu sama lain dan gak saling mempengaruhi besarannya cuma gara-gara urutan hitung. Ini juga asumsi, sama-sama perlu dicek ke PO kalau di poin 1 di atas ternyata jawabannya "boleh gabung".
3. **Lock voucher pakai `SELECT ... FOR UPDATE` di tabel `voucher_claims`, di dalam transaction checkout yang sama** — pola identik `StockLockingService` (Siklus 1 Task 4.1). Alasannya sama: kalau gak di-lock, 2 checkout yang jalan barengan bisa dua-duanya baca status `ditawarkan` (belum keupdate), dua-duanya lolos validasi, dan voucher yang cuma boleh dipakai sekali malah kepake 2x sebelum salah satu commit duluan.
4. **Deteksi "pembelian pertama kali per kategori" pakai raw query manual join**, bukan `include` Prisma biasa — karena `transaction_items.ref_id` itu polymorphic (nunjuk ke `products`/`spareparts`/`services` tergantung kolom `kind`), Prisma gak bisa bikin relasi FK strict buat kolom kayak gitu. Makanya kode WAJIB filter `kind = 'product'` dulu di `WHERE`, baru join manual ke `products` pakai `ref_id`, biar gak salah nyocokin id produk sama id sparepart yang kebetulan collide (walau kecil kemungkinan berhubung cuid, tetep bug kalau kejadian).
5. **Endpoint offer TIDAK gagal total (bukan 1 error 500/409 buat semua member) kalau 1-2 member di antara list-nya duplikat atau gak eligible** — tiap member diproses satu-satu, hasil akhirnya `{ offered: [...], skipped: [{memberId, reason}] }`. Ini lebih ramah dipakai admin yang nge-select banyak member sekaligus daripada seluruh request ke-reject gara-gara 1 orang doang yang bermasalah.
6. **Defense in depth**: eligibility `firstPurchaseOnly` dicek DUA KALI — sekali pas admin offer (Task 3.2, biar gak nawarin voucher yang percuma dari awal), sekali lagi pas checkout beneran pakai voucher-nya (Task 5.4). Alasan double-check: ada jeda waktu antara "voucher ditawarkan" dan "voucher dipakai" — bisa aja member itu keburu beli produk kategori yang sama lewat transaksi lain di antara dua momen itu (mis. ditawarkan hari Senin, servis lain lewat kasir hari Rabu beli produk kategori sama, baru checkout pakai voucher hari Jumat). Kalau cuma dicek sekali pas offer, celah ini kebobolan.

## Peta modul

```
src/
  vouchers/                          → MODUL BARU
    vouchers.module.ts
    vouchers.controller.ts
    vouchers.service.ts
    dto/
      create-voucher-campaign.dto.ts
      offer-campaign.dto.ts
  pos/                                → DIMODIFIKASI (Siklus 1, bukan dibuat ulang)
    dto/checkout.dto.ts               → + field voucherClaimId
    pos.service.ts                    → method checkout() dimodif
    pos.module.ts                     → + import VouchersModule
```

Model Prisma yang dipakai (sudah ada dari `db pull` Task 0.1 Siklus 1, dicantumkan di sini cuma buat referensi nama field camelCase-nya — **jangan bikin migration baru**):
```prisma
enum VoucherDiscountType {
  percentage
  nominal
  @@map("VoucherDiscountType")
}
enum VoucherClaimStatus {
  ditawarkan
  diklaim
  dipakai
  kadaluarsa
  @@map("VoucherClaimStatus")
}
model VoucherCampaign {
  id                  String              @id @default(cuid())
  name                String
  discountType        VoucherDiscountType @map("discount_type")
  discountValue       Decimal             @map("discount_value") @db.Decimal(14, 2)
  category            String?
  firstPurchaseOnly   Boolean             @default(false) @map("first_purchase_only")
  termsAndConditions  String?             @map("terms_and_conditions")
  startDate           DateTime            @map("start_date")
  endDate             DateTime            @map("end_date")
  active              Boolean             @default(true)
  createdAt           DateTime            @default(now()) @map("created_at")
  claims              VoucherClaim[]
  @@map("voucher_campaigns")
}
model VoucherClaim {
  id          String              @id @default(cuid())
  campaignId  String              @map("campaign_id")
  memberId    String              @map("member_id")
  status      VoucherClaimStatus  @default(ditawarkan)
  invoiceId   String?             @map("invoice_id")
  offeredAt   DateTime            @default(now()) @map("offered_at")
  claimedAt   DateTime?           @map("claimed_at")
  usedAt      DateTime?           @map("used_at")
  campaign    VoucherCampaign     @relation(fields: [campaignId], references: [id])
  member      Member              @relation(fields: [memberId], references: [id])
  invoice     Invoice?            @relation(fields: [invoiceId], references: [id])
  @@unique([campaignId, memberId])   // index ini sudah ada persis di dump: voucher_claims_campaign_id_member_id_key
  @@map("voucher_claims")
}
```

---

## Fase 1 — VouchersModule: bikin campaign

### Task 1.1: DTO CreateVoucherCampaignDto

**File:** Create: `src/vouchers/dto/create-voucher-campaign.dto.ts`

```typescript
import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateVoucherCampaignDto {
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['percentage', 'nominal']) discountType: 'percentage' | 'nominal';
  @IsNumber() @Min(0.01) discountValue: number;
  @IsOptional() @IsString() category?: string; // null = berlaku semua kategori
  @IsOptional() @IsBoolean() firstPurchaseOnly?: boolean;
  @IsOptional() @IsString() termsAndConditions?: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
}
```

### Task 1.2: VouchersService.createCampaign

**File:** Create: `src/vouchers/vouchers.service.ts`

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVoucherCampaignDto } from './dto/create-voucher-campaign.dto';

@Injectable()
export class VouchersService {
  constructor(private prisma: PrismaService) {}

  async createCampaign(dto: CreateVoucherCampaignDto) {
    if (new Date(dto.startDate) >= new Date(dto.endDate)) {
      throw new BadRequestException('startDate harus sebelum endDate');
    }
    if (dto.discountType === 'percentage' && dto.discountValue > 100) {
      throw new BadRequestException('Diskon persentase maksimal 100');
    }
    return this.prisma.voucherCampaign.create({
      data: {
        name: dto.name,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        category: dto.category ?? null,
        firstPurchaseOnly: dto.firstPurchaseOnly ?? false,
        termsAndConditions: dto.termsAndConditions,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        active: true,
      },
    });
  }

  // ... method lain ditambah di Task 2.1, 3.1, 4.1
}
```

### Task 1.3: Controller

**File:** Create: `src/vouchers/vouchers.controller.ts`

```typescript
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { VouchersService } from './vouchers.service';
import { CreateVoucherCampaignDto } from './dto/create-voucher-campaign.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('vouchers')
export class VouchersController {
  constructor(private vouchers: VouchersService) {}

  @Roles('admin')
  @Post('campaigns')
  createCampaign(@Body() dto: CreateVoucherCampaignDto) {
    return this.vouchers.createCampaign(dto);
  }

  // endpoint offer & my-claims ditambah di Task 3.3 & 4.3
}
```

**Verifikasi:** login admin, `POST /vouchers/campaigns` dengan `discountType=percentage, discountValue=10, category=AC Split, firstPurchaseOnly=true, startDate="2026-08-20", endDate="2026-09-20"` → 201, cek row muncul di `voucher_campaigns` dengan `active=true`. Kirim `discountValue=150` + `percentage` → 400 "Diskon persentase maksimal 100". Login kasir coba akses → 403.

---

## Fase 2 — Deteksi "pembelian pertama kali per kategori"

### Task 2.1: VouchersService.isEligibleFirstPurchase

**File:** Modify: `src/vouchers/vouchers.service.ts`

```typescript
/**
 * Cek apakah member BELUM PERNAH beli produk kategori tertentu (atau kategori apapun kalau
 * category=null). `transaction_items.ref_id` polymorphic (bisa nunjuk products/spareparts/services
 * tergantung `kind`), jadi WAJIB filter kind='product' dulu sebelum join manual ke `products` —
 * kalau enggak, ref_id sparepart/service bisa ke-cocokin id produk secara kebetulan.
 * `client` bisa `this.prisma` (dipanggil standalone, mis. Task 3.2) atau `tx` (dipanggil di
 * dalam Prisma transaction checkout, Task 5.4) — signature generik biar dua-duanya bisa reuse.
 */
async isEligibleFirstPurchase(client: any, memberId: string, category: string | null): Promise<boolean> {
  const rows: { count: bigint }[] = category
    ? await client.$queryRaw`
        SELECT COUNT(*)::bigint AS count
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti.transaction_id
        JOIN products p ON p.id = ti.ref_id
        WHERE t.member_id = ${memberId}
          AND ti.kind = 'product'
          AND p.category = ${category}
      `
    : await client.$queryRaw`
        SELECT COUNT(*)::bigint AS count
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti.transaction_id
        WHERE t.member_id = ${memberId}
          AND ti.kind = 'product'
      `;
  return Number(rows[0].count) === 0;
}
```

**Verifikasi (unit test):**
```typescript
it('member yang belum pernah beli kategori AC Split eligible first-purchase', async () => {
  const eligible = await service.isEligibleFirstPurchase(prisma, memberBaru.id, 'AC Split');
  expect(eligible).toBe(true);
});

it('member yang sudah punya transaction_items kategori AC Split TIDAK eligible', async () => {
  // seed: transaction + transaction_item kind='product' ref_id=produk kategori 'AC Split' member_id=memberLama.id
  const eligible = await service.isEligibleFirstPurchase(prisma, memberLama.id, 'AC Split');
  expect(eligible).toBe(false);
});

it('riwayat beli sparepart TIDAK dihitung sebagai pembelian kategori produk (defense polymorphic ref_id)', async () => {
  // seed transaction_item kind='sparepart' dengan ref_id yang KEBETULAN sama id-nya dengan produk kategori 'AC Split'
  const eligible = await service.isEligibleFirstPurchase(prisma, memberX.id, 'AC Split');
  expect(eligible).toBe(true); // harus tetap eligible, karena kind bukan 'product'
});
```

---

## Fase 3 — Offer campaign ke member tertentu

### Task 3.1: VouchersService.offerToMembers

**File:** Modify: `src/vouchers/vouchers.service.ts`

```typescript
async offerToMembers(campaignId: string, memberIds: string[], actorId: string) {
  const campaign = await this.prisma.voucherCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new NotFoundException('Campaign tidak ditemukan');
  if (!campaign.active) throw new BadRequestException('Campaign sudah tidak aktif');

  const offered: string[] = [];
  const skipped: { memberId: string; reason: string }[] = [];

  for (const memberId of memberIds) {
    if (campaign.firstPurchaseOnly) {
      const eligible = await this.isEligibleFirstPurchase(this.prisma, memberId, campaign.category);
      if (!eligible) {
        skipped.push({ memberId, reason: 'sudah pernah beli kategori ini, tidak eligible untuk voucher first-purchase' });
        continue;
      }
    }
    try {
      await this.prisma.voucherClaim.create({ data: { campaignId, memberId, status: 'ditawarkan' } });
      offered.push(memberId);
    } catch (err: any) {
      // unique index voucher_claims_campaign_id_member_id_key yang udah ada di schema — ini
      // pengaman utama, DB yang jamin no-duplicate secara atomik walau ada 2 admin nge-klik
      // "offer" ke campaign+member yang sama nyaris barengan.
      if (err.code === 'P2002') {
        skipped.push({ memberId, reason: 'member ini sudah pernah ditawarkan campaign ini' });
      } else {
        throw err;
      }
    }
  }
  await this.prisma.auditLog.create({
    data: { actorUid: actorId, action: 'voucher.offer', target: campaignId, detail: { offered, skipped } },
  });
  return { campaignId, offered, skipped };
}
```

### Task 3.2: DTO OfferCampaignDto

**File:** Create: `src/vouchers/dto/offer-campaign.dto.ts`

```typescript
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class OfferCampaignDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) memberIds: string[];
}
```

### Task 3.3: Endpoint offer

**File:** Modify: `src/vouchers/vouchers.controller.ts`

```typescript
@Roles('admin')
@Post('campaigns/:id/offer')
offer(@Param('id') id: string, @Body() dto: OfferCampaignDto, @CurrentUser() user: any) {
  return this.vouchers.offerToMembers(id, dto.memberIds, user.sub);
}
```

**Verifikasi:**
1. `POST /vouchers/campaigns/:id/offer` body `{ memberIds: ['m1', 'm2'] }` → response `{ offered: ['m1','m2'], skipped: [] }`, cek 2 row baru di `voucher_claims` status `ditawarkan`.
2. Panggil lagi endpoint yang sama persis (offer ulang ke `m1`) → response `{ offered: [], skipped: [{ memberId: 'm1', reason: 'member ini sudah pernah ditawarkan campaign ini' }] }` — **bukan** 500/exception generic.
3. Campaign dengan `firstPurchaseOnly=true, category='AC Split'`, offer ke member yang punya riwayat beli AC Split → masuk `skipped` dengan reason eligibility, bukan `offered`.

---

## Fase 4 — GET voucher yang bisa dipakai member

### Task 4.1: VouchersService.getMyClaims

**File:** Modify: `src/vouchers/vouchers.service.ts`

```typescript
async getMyClaims(memberId: string) {
  const now = new Date();
  return this.prisma.voucherClaim.findMany({
    where: {
      memberId,
      status: { in: ['ditawarkan', 'diklaim'] },
      campaign: { active: true, endDate: { gte: now } },
    },
    include: { campaign: true },
    orderBy: { offeredAt: 'desc' },
  });
}
```

### Task 4.2: Endpoint

**File:** Modify: `src/vouchers/vouchers.controller.ts`

```typescript
@Roles('admin', 'kasir')
@Get('my-claims')
myClaims(@Query('memberId') memberId: string) {
  if (!memberId) throw new BadRequestException('memberId wajib diisi');
  return this.vouchers.getMyClaims(memberId);
}
```

**Verifikasi:** member punya 1 claim `ditawarkan` campaign aktif belum expired → muncul di response. Bikin 1 claim lagi tapi campaign-nya `endDate` sudah lewat → **tidak** muncul. Claim dengan status `dipakai` → tidak muncul (biar kasir gak nawarin voucher yang udah abis ke customer).

---

## Fase 5 — Modifikasi checkout (Siklus 1) buat terima & pakai voucher

### Task 5.1: Wiring module

**File:**
- Modify: `src/vouchers/vouchers.module.ts` — `exports: [VouchersService]`
- Modify: `src/pos/pos.module.ts` — `imports: [VouchersModule, ...]`, inject `VouchersService` ke `PosService`

### Task 5.2: Modifikasi `CheckoutDto`

**File:** Modify: `src/pos/dto/checkout.dto.ts`

Sebelum (Siklus 1, Task 4.2):
```typescript
export class CheckoutDto {
  @ValidateNested() @Type(() => CheckoutCustomerDto) customer: CheckoutCustomerDto;
  @ValidateNested({ each: true }) @Type(() => CheckoutItemDto) @ArrayMinSize(1) items: CheckoutItemDto[];
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsString() discountReason?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxPercent?: number;
  @IsOptional() @IsNumber() @Min(0) transportFee?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => CheckoutInstallationDto) installations?: CheckoutInstallationDto[];
}
```

Sesudah — **1 field baru ditambah**, sisanya tidak berubah:
```typescript
export class CheckoutDto {
  @ValidateNested() @Type(() => CheckoutCustomerDto) customer: CheckoutCustomerDto;
  @ValidateNested({ each: true }) @Type(() => CheckoutItemDto) @ArrayMinSize(1) items: CheckoutItemDto[];
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsString() discountReason?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxPercent?: number;
  @IsOptional() @IsNumber() @Min(0) transportFee?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => CheckoutInstallationDto) installations?: CheckoutInstallationDto[];
  @IsOptional() @IsString() voucherClaimId?: string; // BARU — id row voucher_claims yang mau dipakai (dari GET /vouchers/my-claims)
}
```

### Task 5.3: VouchersService.applyClaimInCheckout (helper dipanggil dari PosService)

**File:** Modify: `src/vouchers/vouchers.service.ts`

```typescript
/**
 * Dipanggil dari PosService.checkout() DI DALAM transaction yang sama. Lock claim, validasi,
 * dan hitung nominal potongannya — TIDAK melakukan write/status-update (itu tanggung jawab
 * PosService setelah invoice ke-generate, karena butuh invoiceId).
 */
async lockAndValidateClaim(tx: any, claimId: string, memberId: string, rawSubtotal: number) {
  // SELECT ... FOR UPDATE — kunci baris ini sampai transaksi checkout commit/rollback, biar
  // checkout lain yang coba pakai voucher yang SAMA harus nunggu (bukan baca status basi).
  const claimRows: any[] = await tx.$queryRaw`
    SELECT * FROM voucher_claims WHERE id = ${claimId} FOR UPDATE
  `;
  const claim = claimRows[0];
  if (!claim) throw new BadRequestException('Voucher tidak ditemukan');
  if (claim.member_id !== memberId) throw new BadRequestException('Voucher ini bukan milik customer ini');
  if (!['ditawarkan', 'diklaim'].includes(claim.status)) {
    throw new BadRequestException('Voucher sudah dipakai atau sudah kadaluarsa');
  }

  const campaign = await tx.voucherCampaign.findUnique({ where: { id: claim.campaign_id } });
  if (!campaign || !campaign.active) throw new BadRequestException('Campaign voucher ini tidak aktif');
  const now = new Date();
  if (now < campaign.startDate || now > campaign.endDate) {
    throw new BadRequestException('Voucher sudah tidak berlaku (di luar periode campaign)');
  }

  if (campaign.firstPurchaseOnly) {
    // defense in depth — sudah dicek pas offer (Task 3.1), dicek ULANG di sini jaga-jaga ada
    // pembelian kategori yang sama lewat transaksi lain di antara waktu offer & checkout ini.
    const eligible = await this.isEligibleFirstPurchase(tx, memberId, campaign.category);
    if (!eligible) throw new BadRequestException('Voucher first-purchase ini sudah tidak berlaku untuk customer (sudah ada riwayat pembelian kategori tsb)');
  }

  const rawDiscount = campaign.discountType === 'percentage'
    ? Math.round((rawSubtotal * Number(campaign.discountValue)) / 100)
    : Math.round(Number(campaign.discountValue));
  const discountAmount = Math.min(rawDiscount, rawSubtotal); // gak boleh bikin subtotal minus

  return { claimId: claim.id, campaignName: campaign.name, discountAmount };
}
```

### Task 5.4: Modifikasi `PosService.checkout()`

**File:** Modify: `src/pos/pos.service.ts`

**SEBELUM** (potongan Task 4.4 Siklus 1, persis dari titik setelah loop lock stok sampai insert invoice adjustment):
```typescript
    const totals = computeTotals(dto.items.map((i) => ({ qty: i.qty, unitPrice: priced.get(i.refId)!.unitPrice })),
      dto.discount ?? 0, dto.taxPercent ?? 0, dto.transportFee ?? 0);
    if ((dto.discount ?? 0) > totals.subtotal) throw new BadRequestException('Diskon melebihi subtotal');

    // 2) transaksi + item
    const transaction = await tx.transaction.create({
      data: { memberId: member.id, customerName: dto.customer.name, customerPhone: member.phone,
        subtotal: totals.subtotal, discount: dto.discount ?? 0, taxPercent: dto.taxPercent ?? 0,
        taxAmount: totals.taxAmount, transportFee: dto.transportFee ?? 0, grandTotal: totals.grandTotal,
        notes: dto.notes, createdBy: actorId },
    });
    // ... (loop transactionItem + stockMovement, TIDAK BERUBAH) ...

    // 3) invoice + invoice_items
    const dateKey = this.counters.dateKey(now);
    const invoiceSeq = await this.counters.nextSeq(tx, `invoice_${dateKey}`);
    const invoice = await tx.invoice.create({
      data: { number: formatInvoiceNumber(dateKey, invoiceSeq), transactionId: transaction.id, memberId: member.id,
        customerName: dto.customer.name, customerPhone: member.phone, subtotal: totals.subtotal, discount: dto.discount ?? 0,
        taxPercent: dto.taxPercent ?? 0, taxAmount: totals.taxAmount, transportFee: dto.transportFee ?? 0,
        grandTotal: totals.grandTotal, totalPaid: 0, status: 'belum_dibayar', notes: dto.notes, createdBy: actorId },
    });
    // ... (loop invoiceItem, TIDAK BERUBAH) ...
    if ((dto.discount ?? 0) > 0) {
      await tx.invoiceAdjustment.create({ data: { invoiceId: invoice.id, amount: dto.discount!, reason: dto.discountReason!, createdBy: actorId } });
    }
```

**SESUDAH** — insert blok voucher SEBELUM `computeTotals`, ganti `dto.discount ?? 0` jadi `totalDiscount` di `transaction.create`/`invoice.create`, dan tambah update status claim setelah invoice ke-generate:
```typescript
    // >>> BARU: validasi & kunci voucher SEBELUM computeTotals, karena discount gabungan
    // (ad-hoc + voucher) harus sudah final sebelum dipakai hitung taxBase/grandTotal <<<
    const rawSubtotal = dto.items.reduce(
      (sum, i) => sum + Math.round(i.qty * priced.get(i.refId)!.unitPrice), 0,
    );
    let voucherDiscountAmount = 0;
    let appliedClaim: { claimId: string; campaignName: string } | null = null;
    if (dto.voucherClaimId) {
      const result = await this.vouchers.lockAndValidateClaim(tx, dto.voucherClaimId, member.id, rawSubtotal);
      voucherDiscountAmount = result.discountAmount;
      appliedClaim = { claimId: result.claimId, campaignName: result.campaignName };
    }
    // ASUMSI BISNIS (lihat "Keputusan desain" #1) — diskon ad-hoc & diskon voucher DIJUMLAH,
    // bukan pilih salah satu. Konfirmasi ke PO sebelum production.
    const totalDiscount = (dto.discount ?? 0) + voucherDiscountAmount;

    const totals = computeTotals(dto.items.map((i) => ({ qty: i.qty, unitPrice: priced.get(i.refId)!.unitPrice })),
      totalDiscount, dto.taxPercent ?? 0, dto.transportFee ?? 0);
    if (totalDiscount > totals.subtotal) throw new BadRequestException('Total diskon (ad-hoc + voucher) melebihi subtotal');

    // 2) transaksi + item
    const transaction = await tx.transaction.create({
      data: { memberId: member.id, customerName: dto.customer.name, customerPhone: member.phone,
        subtotal: totals.subtotal, discount: totalDiscount, taxPercent: dto.taxPercent ?? 0, // <-- totalDiscount, bukan dto.discount lagi
        taxAmount: totals.taxAmount, transportFee: dto.transportFee ?? 0, grandTotal: totals.grandTotal,
        notes: dto.notes, createdBy: actorId },
    });
    // ... (loop transactionItem + stockMovement, TIDAK BERUBAH) ...

    // 3) invoice + invoice_items
    const dateKey = this.counters.dateKey(now);
    const invoiceSeq = await this.counters.nextSeq(tx, `invoice_${dateKey}`);
    const invoice = await tx.invoice.create({
      data: { number: formatInvoiceNumber(dateKey, invoiceSeq), transactionId: transaction.id, memberId: member.id,
        customerName: dto.customer.name, customerPhone: member.phone, subtotal: totals.subtotal, discount: totalDiscount, // <-- idem
        taxPercent: dto.taxPercent ?? 0, taxAmount: totals.taxAmount, transportFee: dto.transportFee ?? 0,
        grandTotal: totals.grandTotal, totalPaid: 0, status: 'belum_dibayar', notes: dto.notes, createdBy: actorId },
    });
    // ... (loop invoiceItem, TIDAK BERUBAH) ...
    if ((dto.discount ?? 0) > 0) {
      await tx.invoiceAdjustment.create({ data: { invoiceId: invoice.id, amount: dto.discount!, reason: dto.discountReason!, createdBy: actorId } });
    }
    // >>> BARU: catat adjustment terpisah buat potongan voucher (audit trail jelas, kelihatan
    // di GET /invoices/:id sebagai baris tersendiri, bukan nyampur sama diskon manual) <<<
    if (appliedClaim) {
      await tx.invoiceAdjustment.create({
        data: { invoiceId: invoice.id, amount: voucherDiscountAmount,
          reason: `Voucher: ${appliedClaim.campaignName}`, createdBy: actorId },
      });
      // update status claim SETELAH invoice ke-generate (butuh invoice.id) — masih di dalam tx
      // yang sama, jadi kalau ada apapun gagal setelah ini, status claim ikut ke-rollback juga.
      await tx.voucherClaim.update({
        where: { id: appliedClaim.claimId },
        data: { status: 'dipakai', usedAt: now, invoiceId: invoice.id },
      });
    }
```

Bagian instalasi (poin 4 di Task 4.4 Siklus 1) dan audit log checkout di baris terakhir **tidak berubah sama sekali**.

**Verifikasi (test paling penting bagian ini — mirror gaya Task 4.1 Siklus 1):**
```typescript
it('voucher yang sama gak bisa dipakai 2x kalau 2 checkout jalan barengan', async () => {
  // setup: campaign nominal Rp 50.000 aktif, claim status='ditawarkan' milik member X
  // setup: 2 produk BEDA (masing2 stock cukup) buat 2 checkout, biar yang gagal murni gara2 voucher, bukan stok
  const results = await Promise.allSettled([
    posService.checkout({ ...baseDtoA, voucherClaimId: claim.id }, actorId),
    posService.checkout({ ...baseDtoB, voucherClaimId: claim.id }, actorId),
  ]);
  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  expect(succeeded).toBe(1); // satu sukses, satu harus reject "Voucher sudah dipakai atau sudah kadaluarsa"

  const finalClaim = await prisma.voucherClaim.findUnique({ where: { id: claim.id } });
  expect(finalClaim.status).toBe('dipakai');
  expect(finalClaim.invoiceId).not.toBeNull();
});

it('checkout dengan voucher percentage 10% + diskon ad-hoc Rp 20.000 digabung dijumlah', async () => {
  // subtotal 1.000.000, voucher percentage 10% => potongan voucher 100.000, discount ad-hoc 20.000
  const result = await posService.checkout({ ...baseDto, discount: 20000, discountReason: 'nego', voucherClaimId: claim.id }, actorId);
  const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
  expect(Number(invoice.discount)).toBe(120000); // 100.000 + 20.000
  const adjustments = await prisma.invoiceAdjustment.findMany({ where: { invoiceId: result.invoiceId } });
  expect(adjustments).toHaveLength(2); // 1 baris ad-hoc, 1 baris voucher — audit trail terpisah
});

it('voucher first-purchase-only ditolak di checkout kalau member ternyata sudah punya riwayat beli kategori itu (defense in depth)', async () => {
  // seed transaction_item history kategori sama SETELAH claim ditawarkan, SEBELUM checkout ini
  await expect(posService.checkout({ ...baseDto, voucherClaimId: claim.id }, actorId))
    .rejects.toThrow('sudah ada riwayat pembelian kategori tsb');
});

it('voucher milik member lain ditolak', async () => {
  await expect(posService.checkout({ ...baseDtoUntukMemberLain, voucherClaimId: claim.id }, actorId))
    .rejects.toThrow('Voucher ini bukan milik customer ini');
});
```

---

## Skenario tes end-to-end

1. Login admin → `POST /vouchers/campaigns` bikin campaign "Diskon AC Split Pertama" — `discountType=percentage, discountValue=10, category='AC Split', firstPurchaseOnly=true, startDate=hari ini, endDate=+30 hari`.
2. Admin cari 3 member kandidat, `POST /vouchers/campaigns/:id/offer` dengan `memberIds=[m1,m2,m3]` — cek response, katakanlah `m2` udah pernah beli AC Split sebelumnya jadi masuk `skipped`, `m1` & `m3` masuk `offered`.
3. Offer ulang ke `m1` (sengaja duplikat) → masuk `skipped` dengan reason "sudah pernah ditawarkan", bukan 500.
4. Login kasir → mulai transaksi buat member `m1`, panggil `GET /vouchers/my-claims?memberId=m1` → voucher campaign tadi muncul.
5. `POST /pos/checkout` jual AC Split ke `m1` dengan `voucherClaimId` dari langkah 4 → cek response invoice, `grandTotal` sudah dipotong 10%.
6. Cek DB: `voucher_claims` row `m1` status jadi `dipakai`, `used_at` keisi, `invoice_id` nunjuk ke invoice yang baru dibuat.
7. Cek `GET /invoices/:id` — ada baris `invoiceAdjustments` dengan `reason` mengandung nama campaign.
8. Coba `POST /pos/checkout` lagi pakai `voucherClaimId` yang sama (voucher udah `dipakai`) → 400 "Voucher sudah dipakai atau sudah kadaluarsa".
9. Jalankan test race condition Task 5.4 (2 checkout barengan pakai voucher yang sama) → cuma 1 yang sukses, stok & claim akhir konsisten.

Kalau 9 langkah ini lolos, Siklus 6 udah nyambung penuh ke alur checkout Siklus 1 tanpa merusak alur yang sudah ada (retail biasa tanpa `voucherClaimId` tetap jalan identik seperti sebelumnya, karena semua logic baru dibungkus `if (dto.voucherClaimId)`).

---

## Dependency

**Siklus ini MEMODIFIKASI kode Siklus 1 yang sudah jadi, bukan modul baru yang berdiri sendiri:**
- `src/pos/dto/checkout.dto.ts` — nambah 1 field opsional, field lama tidak berubah.
- `src/pos/pos.service.ts` — method `checkout()` dimodif (insert blok validasi voucher sebelum `computeTotals`, ganti `dto.discount ?? 0` jadi `totalDiscount` di 2 tempat, tambah blok update status claim setelah invoice terbentuk). Bagian lock stok (Task 4.1), bagian instalasi (poin 4 Task 4.4), dan audit log **tidak disentuh**.
- `src/pos/pos.module.ts` — perlu import `VouchersModule` biar `VouchersService` bisa di-inject ke `PosService`.

**Prasyarat sebelum mulai:** Siklus 1 harus sudah diimplementasi dan lolos skenario e2e-nya sendiri dulu (terutama `StockLockingService` & pola row-locking `checkout()`), karena semua kode di sini nempel langsung di transaction yang sama. Jangan mulai Siklus 6 kalau Siklus 1 masih berubah-ubah strukturnya.

**Yang TIDAK berubah dari modul lain:** `MembersService`, `CountersService`, `AcUnitsService`, `StockLockingService`, `TechnicianJobsService` — semuanya reused apa adanya, gak ada modifikasi.
</content>
