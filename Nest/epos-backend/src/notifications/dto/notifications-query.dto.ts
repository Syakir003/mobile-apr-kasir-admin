import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

// Pola page/pageSize sama kayak AuditLogQueryDto/InvoiceHistoryQueryDto —
// konsisten satu codebase.
export class NotificationsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;
  // ?unreadOnly=true buat halaman/tab "belum dibaca" (opsional, dipakai UI
  // kalau perlu — default-nya nampilin semua). SENGAJA @Transform manual
  // (bukan `@Type(() => Boolean)`, gotcha class-transformer: `Boolean(v)`
  // bikin string apa pun termasuk "false" jadi `true` selama gak kosong) —
  // di sini eksplisit cuma string "true" yang jadi true, selain itu false.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}
