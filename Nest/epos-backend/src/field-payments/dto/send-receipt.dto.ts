import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendReceiptDto {
  // 'wa' (bawaan): kirim lewat nomor toko. 'kertas': teknisi memakai laporan kertas (tanpa sinyal / pelanggan tanpa HP).
  @IsOptional() @IsIn(['wa', 'kertas']) channel?: 'wa' | 'kertas';
  // Nomor/keterangan lembar laporan kertas (opsional), untuk dicocokkan admin.
  @IsOptional() @IsString() @MaxLength(80) paperReportNo?: string;
}
