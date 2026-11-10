import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const SETTLEMENT_MODES = ['catat_kurang', 'catat_lebih', 'selesai_dengan_alasan'] as const;
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];

/** Body `POST /settlements` — setoran tunai satu teknisi, memverifikasi pembayaran yang dicentang. */
export class SettleDto {
  @IsString() technicianId: string;
  @IsArray()
  @ArrayMinSize(1, { message: 'Pilih minimal satu pembayaran yang diserahkan' })
  @ArrayMaxSize(100)
  @IsString({ each: true })
  paymentIds: string[];
  // Uang tunai yang benar-benar diterima admin (rupiah bulat).
  @Type(() => Number) @IsInt() @Min(0) receivedTotal: number;
  // Wajib bila ada selisih: catat sebagai saldo teknisi, atau selesai dengan alasan konkret.
  @IsOptional() @IsIn(SETTLEMENT_MODES) mode?: SettlementMode;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  // Catatan cek sparepart yang dikembalikan (mis. "1 kapasitor kurang").
  @IsOptional() @IsString() @MaxLength(500) sparepartNote?: string;
}

/** Body `POST /settlements/repay` — teknisi melunasi kekurangan setor belakangan. */
export class RepayDto {
  @IsString() technicianId: string;
  @Type(() => Number) @IsInt() @Min(1) amount: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Body `POST /field-payments/:id/reject`. */
export class RejectFieldPaymentDto {
  @IsString() @MaxLength(500) reason: string;
}
