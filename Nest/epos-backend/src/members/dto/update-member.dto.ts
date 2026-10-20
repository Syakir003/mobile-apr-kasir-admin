import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Edit data member (form Member di mobile). Semua field opsional; yang tak dikirim tak diubah. */
export class UpdateMemberDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsIn(['rumah', 'perusahaan', 'toko']) customerType?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
