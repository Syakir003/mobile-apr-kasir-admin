import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { RateLimitService } from '../../common/services/rate-limit.service';

/**
 * Rem buat PATCH /auth/me/password. Beda dari LoginThrottleGuard yang
 * kuncinya IP: di sini yang dibatasi adalah USER-nya (dari `sub` di JWT,
 * bukan dari body), karena endpoint ini udah di belakang JwtAuthGuard —
 * pelakunya selalu sesi yang udah ke-autentikasi, jadi identitasnya lebih
 * tepat dipakai daripada IP.
 *
 * Yang dicegah: seseorang yang kepinjem sesi (HP kebuka di meja, laptop gak
 * di-lock) nebak-nebak `currentPassword` buat ngambil alih akun. Tanpa rem,
 * dia bisa nyoba ribuan kali dalam hitungan menit pakai token yang udah
 * valid — dan endpoint ini gak kelihatan di log login sama sekali.
 *
 * WAJIB dipasang SESUDAH JwtAuthGuard di @UseGuards (urutan dieksekusi
 * kiri-ke-kanan) — kalau kebalik, `request.user` masih kosong pas guard ini
 * jalan dan semua request nempel di satu ember 'anon'.
 */
@Injectable()
export class PasswordThrottleGuard implements CanActivate {
  private static readonly WINDOW_MS = 60 * 1000;
  private static readonly LIMIT = 5;

  constructor(private readonly rateLimit: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user?: { sub?: string } }).user;
    const key = `pwd:${user?.sub ?? 'anon'}`;

    const ok = this.rateLimit.consume(
      key,
      PasswordThrottleGuard.LIMIT,
      PasswordThrottleGuard.WINDOW_MS,
    );
    this.rateLimit.sweep(PasswordThrottleGuard.WINDOW_MS);

    if (!ok) {
      throw new HttpException(
        'Terlalu banyak percobaan ganti password, coba lagi dalam 1 menit',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
