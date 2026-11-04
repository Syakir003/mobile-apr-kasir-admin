import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsIndonesianPhone } from '../../common/is-indonesian-phone.decorator';
import { normalizeMapsInput } from '../../common/maps-url.util';

/** Edit data member (form Member di mobile). Semua field opsional; yang tak dikirim tak diubah. */
export class UpdateMemberDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @IsIndonesianPhone() phone?: string;
  @IsOptional() @IsString() address?: string;
  // Link ATAU ketikan biasa (nama daerah/tempat), sama dengan saat membuat member: dinormalkan jadi URL (lihat
  // normalizeMapsInput). Kosong/spasi = hapus link (disimpan null).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeMapsInput(value))
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\/\S+$/i, { message: 'Link lokasi harus diawali http:// atau https://' })
  mapsUrl?: string | null;
  @IsOptional() @IsIn(['rumah', 'perusahaan', 'toko']) customerType?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
