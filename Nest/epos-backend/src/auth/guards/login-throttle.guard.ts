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
 * Rem buat POST /auth/login — SENGAJA TANPA nambah dependency baru
 * (@nestjs/throttler dkk). Sempet dicoba pasang @nestjs/throttler, tapi
 * `npm install`-nya bikin package-lock.json ke-reresolve gede-gedean gara-gara
 * lockfile di sandbox beda dari punya kamu; daripada ngirim diff lockfile yang
 * berisiko konflik pas kamu install, mending hand-roll. Hitungannya sekarang
 * ditumpangin ke RateLimitService (common/) yang dipakai bareng sama endpoint
 * ganti password.
 *
 * DUA KUNCI, bukan satu (ini perbaikan dari versi sebelumnya yang cuma
 * per-IP):
 *
 *   1. `${ip}:${email}` @ 10/menit — rem brute-force yang sebenernya.
 *   2. `${ip}` @ 40/menit — nangkep serangan yang nyebar ke banyak email
 *      dari satu sumber (spraying), yang lolos dari kunci #1.
 *
 * Kenapa dipecah: toko ini semua stafnya nebeng SATU koneksi internet, jadi
 * dari luar IP-nya kelihatan sama. Versi lama yang cuma per-IP @ 5/menit
 * artinya kasir yang salah ketik password beberapa kali bisa NGUNCI teknisi
 * & admin yang lagi mau login barengan — rem keamanannya malah jadi bikin
 * toko berhenti jalan. Dipisah per-email, salah ketik satu orang gak nular
 * ke yang lain, tapi penyerang tetap kena batas totalnya.
 *
 * Angka 10/menit tetap jauh lebih ketat dari kelihatannya: bcrypt cost 10
 * makan ~100ms per percobaan, jadi nebak password lewat endpoint ini udah
 * gak realistis bahkan sebelum kena rem.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private static readonly WINDOW_MS = 60 * 1000;
  private static readonly PER_EMAIL = 10;
  private static readonly PER_IP = 40;

  constructor(private readonly rateLimit: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = extractIp(request);

    // Body udah ke-parse (body-parser jalan di middleware, sebelum guard)
    // tapi BELUM lewat ValidationPipe — jadi `email` di sini masih bisa
    // apa aja, termasuk object/array. Dinormalisasi seadanya, dan yang
    // bukan string dianggap satu ember '-' biar tetap kena rem.
    const raw = (request.body as { email?: unknown } | undefined)?.email;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '-';

    const okEmail = this.rateLimit.consume(
      `login:${ip}:${email}`,
      LoginThrottleGuard.PER_EMAIL,
      LoginThrottleGuard.WINDOW_MS,
    );
    const okIp = this.rateLimit.consume(
      `login-ip:${ip}`,
      LoginThrottleGuard.PER_IP,
      LoginThrottleGuard.WINDOW_MS,
    );

    this.rateLimit.sweep(LoginThrottleGuard.WINDOW_MS);

    if (!okEmail || !okIp) {
      throw new HttpException(
        'Terlalu banyak percobaan login, coba lagi dalam 1 menit',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/**
 * Ambil IP client. X-Forwarded-For dipercaya karena app ini bakal jalan di
 * belakang reverse proxy — ambil entri PERTAMA (client asli; sisanya rantai
 * proxy). CATATAN: kalau app di-expose LANGSUNG ke internet tanpa proxy,
 * header ini bisa dipalsu client dan rem per-IP jadi gampang dilewatin.
 * Jangan deploy tanpa reverse proxy di depan.
 */
function extractIp(request: Request): string {
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}
