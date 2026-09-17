import { IsStrongPassword } from '../../common/validators/strong-password.decorator';

/**
 * Reset password oleh ADMIN buat user lain (padanan action `resetPassword`
 * di edge function admin-users lama). Gak minta password lama — admin emang
 * gak tau, itu justru alasan fitur ini ada (staff lupa password).
 */
export class ResetPasswordDto {
  @IsStrongPassword()
  newPassword: string;
}
