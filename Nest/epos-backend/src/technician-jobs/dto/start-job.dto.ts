import { IsOptional, IsString } from 'class-validator';

export class StartJobDto {
  // Wajib kecuali unit job ini masuk lewat scan pengisi slot (scan itu sudah dihitung; lihat claimScanCounts).
  @IsOptional() @IsString() scannedBarcode?: string;
}
