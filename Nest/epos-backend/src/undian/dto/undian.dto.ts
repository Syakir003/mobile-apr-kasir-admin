import { IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Payload RPC `create_undian` apa adanya. Validasi di sini hanya tipe; aturan
 * bisnis (batas persen, nilai > 0, tanggal kriteria) dijaga RPC.
 */
export class CreateUndianDto {
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  /** { dateFrom?: 'YYYY-MM-DD', dateTo?: 'YYYY-MM-DD', mustHaveAcPurchase?: boolean } */
  @IsOptional() @IsObject() criteria?: Record<string, unknown>;
  @IsInt() winnerCount: number;
  @IsIn(['persen', 'nominal']) discountType: 'persen' | 'nominal';
  @IsNumber() discountValue: number;
  @IsOptional() @IsNumber() maxDiscountCap?: number;
  @IsOptional() @IsNumber() minPurchase?: number;
  @IsInt() voucherValidDays: number;
}

/** Payload RPC `update_undian_participants` (undianId dari path). */
export class UpdateUndianParticipantsDto {
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) add?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) remove?: string[];
}
