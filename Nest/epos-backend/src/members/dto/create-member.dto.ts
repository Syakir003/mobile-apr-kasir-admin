import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const CUSTOMER_TYPES = ['rumah', 'kantor', 'toko', 'perusahaan', 'lainnya'] as const;

// phone opsional (bukan @IsNotEmpty) — walk-in tanpa HP valid, dapet
// sentinel unik dari MembersService.create (lihat komentarnya).
export class CreateMemberDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsIn(CUSTOMER_TYPES) customerType?: (typeof CUSTOMER_TYPES)[number];
  @IsOptional() @IsString() notes?: string;

  // Dikirim ulang (true) setelah admin/kasir confirm peringatan "nomor HP
  // ini udah kepake member lain" — pola sama kayak confirmOverride di
  // StockInDto (soft-warn + confirm, bukan blokir keras).
  @IsOptional() @IsBoolean() confirmOverride?: boolean;
}
