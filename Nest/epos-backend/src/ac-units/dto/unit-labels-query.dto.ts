import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const LABEL_FILTERS = ['belum_dicetak', 'belum_ditempel', 'sudah_ditempel', 'semua'] as const;
export const LABEL_DATA_FILTERS = ['menunggu_data', 'aktif', 'semua'] as const;

export class UnitLabelsQueryDto {
  // belum_ditempel (default) = belum dicetak + sudah dicetak tapi belum ditempel.
  @IsOptional() @IsIn(LABEL_FILTERS as unknown as string[]) label?: (typeof LABEL_FILTERS)[number];
  @IsOptional() @IsIn(LABEL_DATA_FILTERS as unknown as string[]) data?: (typeof LABEL_DATA_FILTERS)[number];
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class UnitLabelIdsDto {
  @IsString({ each: true }) ids: string[];
}
