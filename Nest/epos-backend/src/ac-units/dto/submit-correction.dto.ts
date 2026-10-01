import { IsDateString, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Usulan koreksi data unit AC dari teknisi. Kirim HANYA field yang mau
 * diubah; minimal satu field harus beda dari data sekarang (dicek service).
 */
export class SubmitCorrectionDto {
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsNumber() @Min(0.1) @Max(99.99) pk?: number;
  @IsOptional() @IsString() roomLocation?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsDateString() installationDate?: string;
  @IsOptional() @IsString() note?: string;
}

export class ReviewCorrectionDto {
  @IsOptional() @IsString() reviewNote?: string;
}
