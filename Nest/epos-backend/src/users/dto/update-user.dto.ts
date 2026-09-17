import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

// Ganti role dan/atau nama tampilan user SETELAH akun dibuat — gap yang
// ditemukan di audit migrasi (padanan `update_user_account` RPC lama, bagian
// role/displayName-nya; bagian `active` udah ada duluan lewat
// PATCH /:id/toggle-active dengan pengaman anti-kunci-diri-sendirinya
// sendiri, sengaja gak digabung ke sini biar pengaman itu gak ke-bypass).
export class UpdateUserDto {
  @IsOptional() @IsIn(['admin', 'kasir', 'teknisi']) role?: 'admin' | 'kasir' | 'teknisi';
  @IsOptional() @IsString() @MinLength(1) displayName?: string;
}
