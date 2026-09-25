import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

// Payload = payload RPC checkout_transaction (migrasi 0030) apa adanya.
// Validasi di sini cuma tipe; nilai (qty > 0, pajak 0-100, duplikat,
// stok, voucher, dst.) divalidasi RPC dengan pesan yang sama seperti di
// aplikasi Flutter. Field lama (memberId, itemCostId, discount per baris,
// discountReason, packageId, confirmOverride) dibuang oleh whitelist.

export class CheckoutCustomerDto {
  @IsString() name: string;
  @IsString() phone: string;
  @IsOptional() @IsString() address?: string;
}

export class CheckoutItemDto {
  @IsIn(['product', 'sparepart', 'service']) kind: 'product' | 'sparepart' | 'service';
  @IsString() refId: string;
  @IsNumber() qty: number;
}

export class CheckoutInstallationDto {
  @IsInt() itemIndex: number;
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsString() technicianId?: string;
}

export class CheckoutServiceUnitDto {
  @IsInt() itemIndex: number;
  @IsString() unitId: string;
  @IsOptional() @IsString() technicianId?: string;
}

export class CheckoutDto {
  @ValidateNested() @Type(() => CheckoutCustomerDto) customer: CheckoutCustomerDto;

  @IsArray() @ValidateNested({ each: true }) @Type(() => CheckoutItemDto)
  items: CheckoutItemDto[];

  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsNumber() taxPercent?: number;
  @IsOptional() @IsNumber() transportFee?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() voucherCode?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CheckoutInstallationDto)
  installations?: CheckoutInstallationDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CheckoutServiceUnitDto)
  serviceUnits?: CheckoutServiceUnitDto[];
}
