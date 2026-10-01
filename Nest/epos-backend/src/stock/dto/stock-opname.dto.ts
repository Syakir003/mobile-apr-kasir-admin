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
