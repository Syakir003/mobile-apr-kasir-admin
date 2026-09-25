import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';
import { AC_UNIT_STATUSES } from './update-ac-unit.dto';

// Unit AC "sudah lama terpasang" yang belum pernah tercatat di sistem
// (customer bawa AC lama beli di tempat lain / dibeli sebelum sistem ini
// ada). Beda dari instalasi baru (createForInstallation, dipanggil dari POS
// checkout produk AC, bukan endpoint terpisah).
//
// `status` OPSIONAL — default tetap 'aktif' (lihat
// AcUnitsService.registerExisting) kalau tidak dikirim, TIDAK mengubah
// perilaku pemanggil lama (ServiceOrdersService.intake, dipakai web, tidak
// pernah mengirim field ini). Ditambah khusus form mobile "Tambah Unit AC"
// yang membiarkan admin pilih status apa pun saat registrasi.
export class CreateAcUnitDto {
  @IsUUID() memberId: string;
  @IsString() @MinLength(1) brand: string;
  @IsString() @MinLength(1) model: string;
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsIn(AC_UNIT_STATUSES) status?: (typeof AC_UNIT_STATUSES)[number];
}
