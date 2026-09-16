import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class IntakeCustomerDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() phone: string;
  @IsOptional() @IsString() address?: string;
  // Diisi kalau admin/kasir milih member LAMA lewat pencarian di form intake
  // (bukan ngetik manual) -> pakai persis member itu, SKIP pencocokan
  // by-phone di MembersService.findOrCreate(). Sama pola persis kayak
  // CheckoutCustomerDto.memberId di pos/dto/checkout.dto.ts.
  @IsOptional() @IsString() memberId?: string;
}

/** Data unit AC yang BELUM PERNAH tercatat di sistem. Semua optional — kasir
 * cuma denger dari mulut customer, gak wajib akurat (boleh dilengkapi teknisi
 * belakangan lewat PATCH /technician-jobs/:id/notes, field bebas teks). */
export class IntakeNewUnitDto {
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  // Kolom `member_ac_units.pk` itu DECIMAL(4,2) — maks 99.99 (PK AC di
  // dunia nyata paling besar ~5). Divalidasi di sini biar salah input
  // (misal "3435" ke-ketik instead of "3.5") ditolak 400 yang jelas,
  // bukan nge-crash 500 gara-gara numeric overflow di Postgres.
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsString() serialNumber?: string;
}

export class ServiceIntakeDto {
  @ValidateNested() @Type(() => IntakeCustomerDto) customer: IntakeCustomerDto;

  /** Keluhan customer + kondisi barang awal -> disimpan ke service_orders.note */
  @IsString() @IsNotEmpty() complaint: string;

  /** Isi salah satu: existingUnitId (hasil scan QR / pilih dari daftar unit member) ATAU newUnit. */
  @IsOptional() @IsString() existingUnitId?: string;
  @IsOptional() @ValidateNested() @Type(() => IntakeNewUnitDto) newUnit?: IntakeNewUnitDto;

  @IsOptional() @IsString() technicianId?: string;
  @IsOptional() @IsDateString() scheduledDate?: string;
}
