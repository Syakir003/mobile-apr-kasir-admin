import { IsOptional, IsString } from 'class-validator';

/** Isi salah satu: categoryId (pilih dari autocomplete) ATAU categoryName
 * (ketik bebas — kalau belum ada di daftar, otomatis jadi kategori baru). */
export class AddFindingDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() categoryName?: string;
  @IsOptional() @IsString() note?: string;
}
