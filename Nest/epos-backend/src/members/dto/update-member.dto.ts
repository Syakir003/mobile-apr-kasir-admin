import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const CUSTOMER_TYPES = ['rumah', 'kantor', 'toko', 'perusahaan', 'lainnya'] as const;

// waOptOut SENGAJA gak ada di sini — itu tetap lewat PATCH :id/wa-opt-out
// (punya efek samping batalin reminder pending, lihat komentar setWaOptOut).
export class UpdateMemberDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsIn(CUSTOMER_TYPES) customerType?: (typeof CUSTOMER_TYPES)[number];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
