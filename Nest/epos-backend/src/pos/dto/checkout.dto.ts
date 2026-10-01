import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
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

  // BARU (Point 2, 2026-09-23) — nunjuk index item PASANGAN (Indoor)-nya di
  // array `items` ini, HANYA diisi di baris Outdoor pas mode "Unit Lengkap".
  // Efeknya di server: harga efektif baris ini DIPAKSA 0 (gak nambah ke
  // total, gak pernah kena warning "di bawah modal"), dan StockMovement
  // baris ini + baris pasangannya dikasih `pairGroupId` yang SAMA. Stok
  // salah satu sisi abis otomatis bikin SELURUH checkout gagal (bawaan
  // locking per-item yang udah ada, lihat PosService.checkout).
  @IsOptional() @IsInt() @Min(0) pairedWithItemIndex?: number;

  // BARU (Sparepart utuh/eceran, 2026-09-30) — cuma dibaca buat kind=
  // 'sparepart' mode konversi/gabungan. 'utuh' = qty dihitung dalam
  // packUnit (roll/tabung/dus), harga = Sparepart.sellPricePack. 'eceran'
  // atau kosong = qty dalam satuan kecil, harga = Sparepart.sellPrice.
  // Sparepart yang sama boleh muncul 2 baris (satu utuh, satu eceran).
  @IsOptional() @IsIn(['utuh', 'eceran']) saleKind?: 'utuh' | 'eceran';
}

export class CheckoutInstallationDto {
  // Siklus AC Indoor/Outdoor Berpasangan (Point 2, 2026-09-23) — BREAKING
  // CHANGE dari `itemIndex: number` tunggal. 1 elemen = unit biasa/Indoor-
  // saja/Outdoor-saja (perilaku lama, cuma dibungkus array). 2 elemen =
  // mode "Unit Lengkap": index ke-0 WAJIB Indoor, index ke-1 WAJIB Outdoor
  // (konvensi urutan, bukan ditebak server — lihat resolveAcUnitPairFields).
  // SEMUA index di sini jadi SATU MemberAcUnit + SATU barcode.
  @IsInt({ each: true }) @Min(0, { each: true }) @ArrayMinSize(1) itemIndexes: number[];
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsString() technicianId?: string;

  // Paket instalasi (opsional) — item-item di paket ini (sparepart + biaya
  // tambahan per unit, lihat InstallationPackagesModule) otomatis jadi
  // baris transaksi/invoice tersendiri dan stok sparepart-nya ikut kepotong,
  // kasir gak perlu nambahin manual satu-satu ke `items[]`.
  @IsOptional() @IsString() packageId?: string;
}

export class CheckoutDto {
  // IsDefined: tanpa ini `customer` yang gak dikirim lolos validasi lalu crash 500.
  @IsDefined() @ValidateNested() @Type(() => CheckoutCustomerDto) customer: CheckoutCustomerDto;

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

  // Kode voucher (opsional, ketik manual kasir) — port dari `voucherCode` di
  // payload checkout mobile. Validasi lengkap (ada/aktif/belum expired/
  // cocok member/min purchase) dilakukan server-side di PosService.checkout,
  // lewat VouchersService.lockAndValidateCode.
  @IsOptional() @IsString() voucherCode?: string;

  // BARU — dikirim ulang (true) setelah kasir/admin confirm dialog warning
  // "harga di bawah modal". Kalau ada baris yang kena warning dan flag ini
  // BUKAN true, checkout batal commit & balikin daftar warning-nya.
  @IsOptional() @IsBoolean() confirmOverride?: boolean;
}
