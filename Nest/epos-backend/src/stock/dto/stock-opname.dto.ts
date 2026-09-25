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

  // `itemCostId` (dulu wajib buat kind='product', desain opname "per-batch")
  // DIHAPUS — schema Supabase aktual cuma punya 1 baris item_costs per
  // (kind, refId), gak ada id/batch buat dirujuk. Opname produk & sparepart
  // sekarang sama-sama per-refId, lihat StockService.opname.

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
