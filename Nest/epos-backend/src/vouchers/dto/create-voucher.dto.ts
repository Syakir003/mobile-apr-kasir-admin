import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** Port 1:1 dari payload RPC `create_voucher` (mobile/Supabase) — satu voucher
 * ad-hoc langsung terikat ke satu member sejak dibuat, bukan campaign yang
 * ditawarkan ke banyak member. `expiresAt` dikirim tanggal polos
 * ('YYYY-MM-DD'), dikunci ke akhir hari WIB di service (sama pola kayak
 * VoucherCampaign lama, lihat startOfDayWIB/endOfDayWIB). */
export class CreateVoucherDto {
  @IsString() @IsNotEmpty() memberId: string;
  @IsIn(['persen', 'nominal']) discountType: 'persen' | 'nominal';
  @IsNumber() @Min(0.01) discountValue: number;
  @IsOptional() @IsNumber() @Min(0.01) maxDiscountCap?: number;
  @IsOptional() @IsNumber() @Min(0) minPurchase?: number;
  @IsDateString() expiresAt: string;
  @IsOptional() @IsString() note?: string;
}
