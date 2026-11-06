import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  INTAKE_JOB_TYPES,
  type IntakeJobType,
} from '../../service-orders/dto/service-intake.dto';

/**
 * Teknisi menambah unit AC ke jobnya yang Ditugaskan/Sedang Dikerjakan (customer minta AC lain ikut diservis di tempat).
 * Pilih SALAH SATU jalur:
 *  - `barcode`: unit sudah berlabel (hasil scan QR) -> job baru untuk unit itu;
 *  - `newUnit: true`: AC belum pernah tercatat/berlabel -> unit baru berstatus "menunggu_data" dengan QR baru
 *    (dicetak teknisi), lalu teknisi scan QR itu dan mengisi merk/PK lewat Scan Unit.
 */
export class AddUnitDto {
  @IsOptional() @IsString() @MaxLength(200) barcode?: string;

  @IsOptional() @IsBoolean() newUnit?: boolean;

  // Hanya untuk newUnit (label unit baru menampilkan ruangannya). Unit berlabel sudah punya datanya sendiri.
  @IsOptional() @IsString() @MaxLength(100) roomLocation?: string;

  // Jenis pekerjaan unit ini; kosong = mengikuti jenis job yang sedang dikerjakan.
  @IsOptional() @IsIn(INTAKE_JOB_TYPES) jobType?: IntakeJobType;

  // Pekerjaan/keluhan unit ini (WAJIB; dicek di service setelah trim). Jadi temuan awal unit baru itu, supaya tempat
  // foto sebelum/sesudah + deskripsi langsung ada. Kalau tidak ada keluhan, isi pekerjaannya, mis. "Cuci AC".
  @IsOptional() @IsString() @MaxLength(500) complaint?: string;
}
