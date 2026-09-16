import { IsEmail, IsIn, IsString } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/strong-password.decorator';

export class CreateUserDto {
  @IsEmail() email: string;
  // Policy password-nya sekarang tinggal di satu tempat
  // (common/validators/strong-password.decorator.ts) — dipakai bareng sama
  // ChangePasswordDto & ResetPasswordDto biar ketiganya gak bisa lari beda
  // pas salah satunya di-update.
  @IsStrongPassword()
  password: string;
  @IsString() displayName: string;
  @IsIn(['admin', 'kasir', 'teknisi']) role: 'admin' | 'kasir' | 'teknisi';
}
