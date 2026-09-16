import { IsString, IsNotEmpty } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/strong-password.decorator';

export class ChangePasswordDto {
  /**
   * Password LAMA wajib diisi walau user-nya udah bawa JWT valid. Alasannya:
   * token yang bocor/kepinjem (HP kebuka di meja, laptop gak di-lock) jangan
   * sampai bisa dipakai buat NGUNCI pemilik aslinya keluar dari akunnya
   * sendiri. Cuma di-@IsNotEmpty, TIDAK di-@IsStrongPassword — user lama
   * bisa aja punya password yang gak lolos policy baru, dan mereka harus
   * tetap bisa ganti.
   */
  @IsString()
  @IsNotEmpty({ message: 'Password lama wajib diisi' })
  currentPassword: string;

  @IsStrongPassword()
  newPassword: string;
}
