import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class IntakeCustomerDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() phone: string;
  @IsOptional() @IsString() address?: string;
  // Link Google Maps lokasi pelanggan; kalau diisi, ikut disimpan/diperbarui di member.
  @IsOptional() @IsString() @MaxLength(500) @Matches(/^https?:\/\/\S+$/i, { message: 'Link lokasi harus diawali http:// atau https://' }) mapsUrl?: string;
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
  // Mode "QR dulu" (sama dengan Input Data Lampau): tipe AC belum diketahui, unit dibuat berstatus
  // 'menunggu_data' dan teknisi yang mengisi merk/PK saat Scan Unit. Hanya roomLocation yang boleh menyertai;
  // merk/model/PK/no. seri ditolak supaya tidak ada data yang diam-diam terbuang.
  @IsOptional() @IsBoolean() qrDulu?: boolean;
}

/** Satu unit dalam order servis: pilih salah satu existingUnitId ATAU newUnit. */
export class IntakeUnitDto {
  @IsOptional() @IsString() existingUnitId?: string;
  @IsOptional() @ValidateNested() @Type(() => IntakeNewUnitDto) newUnit?: IntakeNewUnitDto;
}

/** Jenis pekerjaan yang bisa dipilih di form Terima Servis (pemasangan berasal dari POS, tidak ditawarkan di sini). */
export const INTAKE_JOB_TYPES = ['perbaikan', 'cuci', 'maintenance'] as const;
export type IntakeJobType = (typeof INTAKE_JOB_TYPES)[number];

export class ServiceIntakeDto {
  // IsDefined: tanpa ini `customer` yang gak dikirim lolos validasi lalu crash 500.
  @IsDefined() @ValidateNested() @Type(() => IntakeCustomerDto) customer: IntakeCustomerDto;

  /**
   * Jenis pekerjaan untuk SELURUH order (semua unit sama): 'perbaikan' (bawaan bila tidak dikirim), 'cuci', atau
   * 'maintenance'. Cuci & maintenance meminta siklus servis berikutnya saat admin menyetujui, supaya pengingat WA
   * terjadwal (lihat SCHEDULING_JOB_TYPES di reminders/service-schedule.util.ts).
   */
  @IsOptional() @IsIn(INTAKE_JOB_TYPES) jobType?: IntakeJobType;

  /**
   * Deskripsi pekerjaan (OPSIONAL, mis. "Cuci AC rutin semua unit") -> disimpan ke service_orders.note dan
   * ditampilkan di halaman teknisi sebagai note pekerjaan. Kosong -> note order = keluhan.
   */
  @IsOptional() @IsString() @MaxLength(1000) workDescription?: string;

  /**
   * Keluhan awal customer + kondisi barang (WAJIB; servis rutin tanpa keluhan cukup diisi pekerjaannya, mis.
   * "Cuci AC"). Jadi temuan awal tiap unit. Dicek di service (setelah trim) supaya pesannya jelas.
   */
  @IsOptional() @IsString() complaint?: string;

  /** Isi salah satu: existingUnitId (hasil scan QR / pilih dari daftar unit member) ATAU newUnit. */
  @IsOptional() @IsString() existingUnitId?: string;
  @IsOptional() @ValidateNested() @Type(() => IntakeNewUnitDto) newUnit?: IntakeNewUnitDto;

  /**
   * Servis BANYAK unit AC dalam satu order (satu nota): daftar unit, tiap entri existingUnitId ATAU newUnit.
   * Dipakai MENGGANTIKAN existingUnitId/newUnit di atas (jangan dikirim bersamaan). Tiap unit jadi satu job
   * sendiri (temuan, foto, scan, riwayat per unit); ketiganya tetap di satu order & satu invoice.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20, { message: 'Maksimal 20 unit AC per order servis' })
  @ValidateNested({ each: true })
  @Type(() => IntakeUnitDto)
  units?: IntakeUnitDto[];

  @IsOptional() @IsString() technicianId?: string;
  @IsOptional() @IsDateString() scheduledDate?: string;
}
