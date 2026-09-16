import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MinLength } from 'class-validator';

/**
 * Satu-satunya tempat aturan password ditulis. Sebelumnya policy-nya cuma
 * nempel di CreateUserDto — begitu ada endpoint kedua & ketiga yang nerima
 * password (ganti sendiri + reset admin), aturan yang di-copy-paste itu
 * pasti bakal beda-beda pas salah satunya di-update. Dijadiin dekorator
 * gabungan biar ketiganya dijamin sama.
 *
 * Aturannya: minimal 8 karakter, wajib ada huruf DAN angka.
 */
export function IsStrongPassword() {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: 'Password minimal 8 karakter' }),
    Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
      message: 'Password wajib kombinasi huruf dan angka',
    }),
  );
}
