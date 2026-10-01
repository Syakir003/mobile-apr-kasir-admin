import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// Status `MemberAcUnit` beneran cuma `String` polos di schema (komentarnya
// sendiri bilang "'aktif' | 'menunggu_pemasangan' | dst") — 3 nilai di bawah
// ini yang NYATA dipakai kode (lihat ac-units.service.ts registerExisting/
// createForInstallation & technician-jobs.service.ts start/complete job).
// Enum di DTO ini SENGAJA disamain manual ke situ buat validasi form edit
// admin (cegah typo), bukan berarti kolomnya di-lock jadi enum beneran di DB.
const AC_UNIT_STATUSES = ['menunggu_pemasangan', 'aktif', 'dalam_maintenance', 'menunggu_data'] as const;

// Semua field opsional (PATCH parsial, sama pola kayak UpdateSparepartDto) —
// gak ada field yang di-exclude kayak `stock` di produk/sparepart, karena
// unit AC gak punya kolom yang "cuma boleh dimutasi lewat service lain"
// sekelas itu (barcodeValue & memberId sengaja TIDAK ada di DTO ini — itu
// identitas unit, bukan data yang wajar diedit lewat form biasa).
export class UpdateAcUnitDto {
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsIn(AC_UNIT_STATUSES) status?: (typeof AC_UNIT_STATUSES)[number];
  @IsOptional() @IsDateString() installationDate?: string;
  @IsOptional() @IsDateString() lastServiceDate?: string;
  @IsOptional() @IsDateString() nextServiceDate?: string;
  // Pengingat servis per unit AC (2026-09-30) — 1 unit = 1 set AC
  // (indoor+outdoor). Siklus servis dalam hari (7–730), manual per unit.
  @IsOptional() @IsInt({ message: 'Siklus servis harus bilangan bulat (hari)' }) @Min(7, { message: 'Siklus servis minimal 7 hari' }) @Max(730, { message: 'Siklus servis maksimal 730 hari' }) serviceIntervalDays?: number;
  // Saklar pengingat: false = matikan (mis. AC dibongkar / tidak dipakai lagi).
  @IsOptional() @IsBoolean() reminderEnabled?: boolean;
}
