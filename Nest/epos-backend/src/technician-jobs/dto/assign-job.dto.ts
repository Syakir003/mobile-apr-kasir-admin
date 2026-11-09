import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AssignJobDto {
  // Satu teknisi (bentuk lama, dipakai APK lama) ATAU `technicianIds` (maks 5, semua setara); salah satu wajib diisi
  // (dicek di controller). Bila dua-duanya ada, `technicianIds` menang.
  @IsOptional() @IsString() @IsNotEmpty() technicianId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) technicianIds?: string[];

  // Servis banyak AC: tugaskan teknisi yang sama ke SEMUA job order ini yang masih bisa ditugaskan
  // (menunggu_penugasan/assigned/sedang_dikerjakan), bukan hanya job ini.
  @IsOptional() @IsBoolean() allInOrder?: boolean;

  // Alasan alih tugas (opsional; mis. "teknisi sakit", "dilanjut besok"). Dicatat di riwayat alih tugas.
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
