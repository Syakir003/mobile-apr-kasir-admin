import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Sinkron sama enum InvoiceStatus di schema.prisma.
const INVOICE_STATUSES = [
  'belum_dibayar',
  'dp',
  'kurang_bayar',
  'lunas',
  'refund',
  'batal',
] as const;

/**
 * Query buat halaman "Riwayat Transaksi" — pola page/pageSize sama persis
 * kayak HistoryQueryDto punya TechnicianJobsService (technician-jobs), biar
 * konsisten. Tambahan filter: q (cari nomor invoice/nama/HP), status, dan
 * rentang tanggal from/to (format YYYY-MM-DD, inclusive di kedua ujung).
 */
export class InvoiceHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsIn(INVOICE_STATUSES) status?: (typeof INVOICE_STATUSES)[number];
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}
