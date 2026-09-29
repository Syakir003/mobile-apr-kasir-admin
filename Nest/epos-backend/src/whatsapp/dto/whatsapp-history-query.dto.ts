import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { WhatsappLogStatus, WhatsappMessageKind } from '@prisma/client';

/** Query buat halaman "Riwayat WA" — pola page/pageSize sama kayak
 * InvoiceHistoryQueryDto/AuditLogQueryDto, konsisten satu codebase. */
export class WhatsappHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;
  @IsOptional() @IsEnum(WhatsappMessageKind) kind?: WhatsappMessageKind;
  @IsOptional() @IsEnum(WhatsappLogStatus) status?: WhatsappLogStatus;
  // Dicocokkan ke nomor HP atau nama member.
  @IsOptional() @IsString() q?: string;
}
