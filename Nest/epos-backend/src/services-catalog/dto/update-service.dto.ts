import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Sama seperti CreateServiceDto, semua opsional (PATCH parsial). Jasa gak
// punya kolom stok, jadi gak ada field yang perlu dikecualikan kayak
// UpdateProductDto/UpdateSparepartDto.
export class UpdateServiceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsNumber() @Min(0) basePrice?: number;
  @IsOptional() @IsInt() durationMinutes?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
