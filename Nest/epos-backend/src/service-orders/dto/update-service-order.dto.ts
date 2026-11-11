import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { INTAKE_JOB_TYPES, IntakeLocationDto } from './service-intake.dto';
import type { IntakeJobType } from './service-intake.dto';

/** Titik lokasi kerja SATU unit (job) yang dikoreksi; alamat dan link kosong = ikut alamat pelanggan. */
export class UnitLocationEditDto extends IntakeLocationDto {
  @IsString() @IsNotEmpty() jobId: string;
}

/**
 * PATCH /service-orders/:id (admin) — koreksi data order yang salah dimasukkan saat Terima Servis. Semua field opsional;
 * yang tidak dikirim tidak diubah. Jadwal, jenis pekerjaan, dan note berlaku untuk SELURUH order (semua unit yang belum
 * selesai); titik lokasi kerja per unit lewat `unitLocations`.
 */
export class UpdateServiceOrderDto {
  // Jadwal tetap wajib terisi: boleh diganti, tidak boleh dikosongkan. Format YYYY-MM-DD.
  @IsOptional() @IsDateString({}, { message: 'Jadwal tidak valid (format YYYY-MM-DD)' }) scheduledDate?: string;

  // Pemasangan berasal dari POS (ditagih lewat invoice POS), jadi tidak bisa dipilih/diganti di sini.
  @IsOptional()
  @IsIn(INTAKE_JOB_TYPES, { message: 'Jenis pekerjaan hanya perbaikan, cuci, maintenance, bongkar, pasang, atau bongkar pasang' })
  jobType?: IntakeJobType;

  // Note Pekerjaan (deskripsi pekerjaan); kosong/spasi = hapus.
  @IsOptional() @IsString() @MaxLength(2000) note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200, { message: 'Terlalu banyak titik lokasi dalam satu permintaan' })
  @ValidateNested({ each: true })
  @Type(() => UnitLocationEditDto)
  unitLocations?: UnitLocationEditDto[];
}
