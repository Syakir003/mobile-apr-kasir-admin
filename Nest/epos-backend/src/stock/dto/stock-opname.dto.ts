import {
  ArrayMinSize,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
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

  // Wajib diisi kalau kind='product' — batch (item_costs) mana yang
  // dikoreksi. Siklus batch-cost (2026-09): opname produk sekarang PER-
  // BATCH, bukan per-produk lagi (produk bisa punya banyak batch aktif
  // sekaligus, gak ada lagi 1 angka stok tunggal).
  @ValidateIf((o: OpnameItemDto) => o.kind === 'product')
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
