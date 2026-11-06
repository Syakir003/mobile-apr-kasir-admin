import { IsString, MaxLength } from 'class-validator';

/** Deskripsi/penjelasan tambahan teknisi pada satu temuan (kosong = hapus deskripsi). */
export class UpdateFindingDto {
  @IsString() @MaxLength(1000) note: string;
}
