import { IsNotEmpty, IsString } from 'class-validator';

/** Admin nambah kategori masalah/jenis servis baku secara manual (di luar
 * flow auto-create saat teknisi ngetik bebas di suatu temuan). */
export class CreateCategoryDto {
  @IsString() @IsNotEmpty() name: string;
}
