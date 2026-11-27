import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SetCostDto {
  @IsNumber()
  @Min(0)
  buyPrice: number;

  @IsOptional() @IsString() supplierName?: string;

  // Gulungan lain dari satu penerimaan (satu nota, satu harga).
  @IsOptional() @IsArray() @IsString({ each: true }) alsoItemCostIds?: string[];

  @IsOptional() @IsBoolean() confirmOverride?: boolean;
}

export class CostListQueryDto {
  @IsOptional() @IsIn(['pending', 'all']) filter?: 'pending' | 'all';

  @IsOptional() @IsString() refId?: string;
}
