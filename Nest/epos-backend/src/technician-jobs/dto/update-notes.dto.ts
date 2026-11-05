import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateNotesDto {
  @IsString() notes: string;

  // Servis banyak AC: Keterangan teknisi satu untuk seluruh order, disalin ke semua job order ini yang masih aktif.
  @IsOptional() @IsBoolean() allInOrder?: boolean;
}
