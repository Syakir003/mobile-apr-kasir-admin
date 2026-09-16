import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class StockMovementsQueryDto {
  @IsOptional()
  @IsIn(['product', 'sparepart'])
  itemKind?: 'product' | 'sparepart';

  @IsOptional()
  @IsString()
  refId?: string;

  // 'penjualan' | 'pemakaian_servis' | 'barang_masuk' | 'opname'
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
