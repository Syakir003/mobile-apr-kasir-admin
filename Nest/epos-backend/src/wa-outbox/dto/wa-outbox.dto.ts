import { IsIn, IsOptional, IsString } from 'class-validator';

export const WA_OUTBOX_STATUSES = ['pending', 'terkirim', 'gagal', 'dibatalkan'] as const;

export class WaOutboxQueryDto {
  @IsOptional() @IsIn(WA_OUTBOX_STATUSES) status?: (typeof WA_OUTBOX_STATUSES)[number];
}

/** Payload RPC `cancel_wa_message` (selain `id`, yang diambil dari path). */
export class CancelWaMessageDto {
  @IsOptional() @IsString() reason?: string;
}
