import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AssignJobDto {
  @IsString() @IsNotEmpty() technicianId: string;

  // Servis banyak AC: tugaskan teknisi yang sama ke SEMUA job order ini yang masih bisa ditugaskan
  // (menunggu_penugasan/assigned/sedang_dikerjakan), bukan hanya job ini.
  @IsOptional() @IsBoolean() allInOrder?: boolean;

  // Alasan alih tugas (opsional; mis. "teknisi sakit", "dilanjut besok"). Dicatat di riwayat alih tugas.
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
