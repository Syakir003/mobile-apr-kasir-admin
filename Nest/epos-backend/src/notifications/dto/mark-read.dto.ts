import { IsOptional, IsString } from 'class-validator';

// Padanan RPC `mark_notifications_read` lama — tanpa notificationId berarti
// tandai SEMUA notifikasi milik user ini sebagai terbaca.
export class MarkReadDto {
  @IsOptional()
  @IsString()
  notificationId?: string;
}
