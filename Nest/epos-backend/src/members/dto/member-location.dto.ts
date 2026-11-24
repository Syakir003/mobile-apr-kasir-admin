import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { normalizeMapsInput } from '../../common/maps-url.util';

/**
 * Lokasi tambahan member multi lokasi (Lokasi 2, 3, ...). Lokasi 1 = alamat utama member, diubah lewat PATCH /members/:id
 * (address, mapsUrl, mainLocationName). Isi alamat ATAU link Maps (minimal salah satu, dicek di service).
 */
export class CreateMemberLocationDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  // Link ATAU ketikan biasa (nama daerah/tempat): dinormalkan jadi URL (lihat normalizeMapsInput).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeMapsInput(value))
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\/\S+$/i, { message: 'Link lokasi harus diawali http:// atau https://' })
  mapsUrl?: string;
}

export class UpdateMemberLocationDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  // Kosong/spasi = hapus (disimpan null); salah satu dari alamat/link tetap harus ada (dicek di service).
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeMapsInput(value))
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\/\S+$/i, { message: 'Link lokasi harus diawali http:// atau https://' })
  mapsUrl?: string | null;
}

/** Pindahkan beberapa unit AC milik member ke satu lokasi (`locationId` = 'utama' untuk Lokasi 1, selain itu id lokasi). */
export class MoveUnitsLocationDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Pilih minimal satu unit' })
  @ArrayMaxSize(100, { message: 'Maksimal 100 unit sekali pindah' })
  @IsString({ each: true })
  unitIds: string[];

  @IsString() @IsNotEmpty() locationId: string;
}
