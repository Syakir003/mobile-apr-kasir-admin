import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query buat halaman "Log Audit" — pola page/pageSize sama persis kayak
 * InvoiceHistoryQueryDto (invoices), biar konsisten satu codebase.
 *
 * `group` cocokin PREFIX kolom `action` (mis. group='pos' nyangkut
 * 'pos.checkout' & 'pos.payment') — sengaja bukan enum/IsIn kayak
 * InvoiceHistoryQueryDto.status, soalnya daftar action terus nambah tiap ada
 * fitur baru (lihat semua `auditLog.create({ data: { action: ... } })` yang
 * tersebar di service lain) dan gak ada satu sumber kebenaran buat
 * enumerate-nya di backend. Frontend yang nyimpen daftar grup buat
 * dropdown filter (sama kayak `auditActionLabels`/group di app mobile).
 */
export class AuditLogQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;
  // Dicocokkan ke action/target/nama-email aktor.
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() group?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}
