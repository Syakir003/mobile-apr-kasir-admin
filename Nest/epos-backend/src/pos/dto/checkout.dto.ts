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

  // Paket instalasi (opsional) — item-item di paket ini (sparepart + biaya
  // tambahan per unit, lihat InstallationPackagesModule) otomatis jadi
  // baris transaksi/invoice tersendiri dan stok sparepart-nya ikut kepotong,
  // kasir gak perlu nambahin manual satu-satu ke `items[]`.
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
