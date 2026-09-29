import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const WA_OUTBOX_STATUSES = ['pending', 'terkirim', 'gagal', 'dibatalkan'] as const;

export class WaOutboxQueryDto {
  @IsOptional() @IsIn(WA_OUTBOX_STATUSES) status?: (typeof WA_OUTBOX_STATUSES)[number];
}

/** Payload RPC `cancel_wa_message` (selain `id`, yang diambil dari path). */
export class CancelWaMessageDto {
  @IsOptional() @IsString() reason?: string;
}

export const WA_OUTBOX_KINDS = ['selesai_servis', 'reminder_h3', 'reminder_h7', 'menang_undian', 'voucher_baru'] as const;

/** Query halaman web "Riwayat WA" (GET /whatsapp-logs). */
export class WhatsappLogQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20;
  @IsOptional() @IsIn(WA_OUTBOX_KINDS) kind?: string;
  @IsOptional() @IsIn(WA_OUTBOX_STATUSES) status?: string;
  // Dicocokkan ke nomor HP atau nama member.
  @IsOptional() @IsString() q?: string;
}
