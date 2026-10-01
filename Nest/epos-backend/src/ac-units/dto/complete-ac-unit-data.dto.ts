import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Teknisi/admin melengkapi unit 'menunggu_data' (Input Data Lampau). Merk dan
 * PK wajib; sisanya opsional.
 */
export class CompleteAcUnitDataDto {
  @IsString({ message: 'Merk wajib diisi' }) @IsNotEmpty({ message: 'Merk wajib diisi' }) brand: string;
  @IsNumber({}, { message: 'PK wajib diisi (angka)' }) @Min(0.1, { message: 'PK tidak valid' }) @Max(99.99, { message: 'PK tidak valid' }) pk: number;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsDateString() installationDate?: string;
  @IsOptional() @IsDateString() lastServiceDate?: string;
}
