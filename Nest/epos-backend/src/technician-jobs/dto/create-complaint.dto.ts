import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Admin membuat job komplain dari job yang sudah selesai (`POST /technician-jobs/:id/complaint`). Data pelanggan, unit,
 * dan lokasi kerja disalin dari job awal; yang diisi admin hanya keluhan, jadwal, dan (opsional) teknisinya.
 */
export class CreateComplaintDto {
  /**
   * Job SELESAI yang dikomplain (satu per unit AC), semuanya harus dari order yang sama dengan job di URL.
   * Kosong = hanya job di URL.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined, { each: true }) jobIds?: string[];

  /** Keluhan pelanggan (WAJIB). Jadi temuan awal tiap unit di job komplain, tempat foto sebelum/sesudah yang baru. */
  @IsString() @IsNotEmpty({ message: 'Keluhan wajib diisi' }) @MaxLength(500) complaint: string;

  /** Tidak dikirim = teknisi job awal; null = belum ditentukan (admin menugaskan belakangan). */
  @IsOptional() @IsUUID() technicianId?: string | null;

  /** Jadwal pengerjaan ulang (YYYY-MM-DD), wajib seperti Terima Servis. */
  @IsDateString({}, { message: 'Jadwal wajib diisi' }) scheduledDate: string;
}
