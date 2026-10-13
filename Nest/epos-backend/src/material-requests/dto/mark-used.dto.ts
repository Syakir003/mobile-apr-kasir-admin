import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class MarkUsedItemDto {
  @IsString() @IsNotEmpty() itemId: string;
  /** Jumlah yang benar-benar terpakai, 0..jumlah yang disetujui. */
  @IsNumber() @Min(0) qtyUsed: number;
}

/** Body opsional: tanpa `items` = semua item dianggap terpakai penuh (perilaku
 * lama, dipakai klien lama/mobile). Dengan `items`, SEMUA item pengajuan wajib ada. */
export class MarkUsedDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MarkUsedItemDto)
  items?: MarkUsedItemDto[];

  @IsOptional() @IsString() note?: string;
}
