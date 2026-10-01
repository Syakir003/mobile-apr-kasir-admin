import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ManualInvoiceItemDto } from '../../invoices/dto/create-manual-invoice.dto';

/**
 * Member: pilih yang sudah ada (`memberId`) ATAU buat baru (`name` + opsional
 * phone). XOR dicek di service. Untuk member baru HP boleh kosong (customer
 * lama sering tidak punya data HP), tapi alamat dianjurkan karena tercetak
 * di label QR — wajib kalau ada unit mode "QR dulu".
 */
export class LegacyMemberDto {
  @IsOptional() @IsString() memberId?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsIn(['rumah', 'perusahaan', 'toko']) customerType?: string;
}

export const LEGACY_UNIT_MODES = ['diketahui', 'qr_dulu'] as const;
export type LegacyUnitMode = (typeof LEGACY_UNIT_MODES)[number];

export class LegacyUnitDto {
  // 'diketahui' = tipe AC sudah diketahui -> status 'aktif'.
  // 'qr_dulu'   = tipe belum diketahui -> status 'menunggu_data', teknisi
  //               yang melengkapi saat scan di lokasi.
  @IsIn(LEGACY_UNIT_MODES) mode: LegacyUnitMode;

  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsNumber() @Min(0.1) @Max(99.99) pk?: number;
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsDateString() installationDate?: string;

  // Pilih dari master produk (opsional) — boleh salah satu atau dua-duanya.
  @IsOptional() @IsString() indoorProductId?: string;
  @IsOptional() @IsString() outdoorProductId?: string;

  // Pengingat servis. Kosong/tanpa siklus = pengingat OFF (diatur nanti di
  // Monitoring Jadwal).
  @IsOptional() @IsDateString() lastServiceDate?: string;
  @IsOptional()
  @IsInt({ message: 'Siklus servis harus bilangan bulat (hari)' })
  @Min(7, { message: 'Siklus servis minimal 7 hari' })
  @Max(730, { message: 'Siklus servis maksimal 730 hari' })
  serviceIntervalDays?: number;
  @IsOptional() @IsBoolean() reminderEnabled?: boolean;
}

export class LegacyInvoiceDto {
  @IsDateString() date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualInvoiceItemDto)
  items: ManualInvoiceItemDto[];

  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsNumber() @Min(0) transportFee?: number;
  @IsOptional() @IsNumber() @Min(0) totalPaid?: number;
  @IsOptional() @IsString() notes?: string;
}

export class LegacyImportDto {
  @ValidateNested() @Type(() => LegacyMemberDto) member: LegacyMemberDto;

  @IsArray()
  @ArrayMaxSize(50, { message: 'Maksimal 50 unit AC per sekali simpan' })
  @ValidateNested({ each: true })
  @Type(() => LegacyUnitDto)
  units: LegacyUnitDto[];

  // OPSIONAL — banyak customer lama nominalnya sudah tak tercatat.
  @IsOptional() @ValidateNested() @Type(() => LegacyInvoiceDto) invoice?: LegacyInvoiceDto;
}
