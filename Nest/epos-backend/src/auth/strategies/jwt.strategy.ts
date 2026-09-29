import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  role: 'admin' | 'kasir' | 'teknisi';
  /** Diisi otomatis sama @nestjs/jwt pas sign, satuannya DETIK (bukan ms).
   * Dipakai di validate() buat bandingin sama `user.passwordChangedAt`. */
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Sama kayak auth.module.ts — gak ada fallback hardcoded lagi, dijamin
      // keisi sama assertRequiredEnv() di main.ts sebelum app boot.
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  /**
   * Dipanggil tiap request bertoken valid. Re-check `active` ke DB di sini
   * (bukan cuma percaya klaim JWT) — supaya user yang baru di-nonaktifkan
   * admin langsung ketolak request berikutnya, gak nunggu token expired.
   * Ini setara `custom_access_token_hook` yang cuma kasih klaim kalau
   * `active=true` (lihat auth_role_hook.sql), tapi dicek di request-time
   * karena JWT kita self-contained (gak reissued tiap request).
   *
   * Sejak ada fitur ganti/reset password, di sini JUGA dicek apakah token
   * ini diterbitkan SEBELUM password terakhir diganti (lihat
   * `passwordChangeStamp()` di auth.service.ts). Tanpa cek ini, ganti
   * password sama sekali gak nendang sesi lama — kalau akun kebobol lalu
   * passwordnya diganti, token si penyusup TETAP jalan sampai expired
   * (default 8 jam), jadi fitur ganti passwordnya nyaris gak ada gunanya
   * buat kasus yang paling penting.
   */
  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('Akun tidak aktif atau tidak ditemukan');
    }

    if (user.passwordChangedAt && payload.iat !== undefined) {
      // `iat` detik -> ms. Strict `<` (bukan `<=`): token pengganti yang
      // diterbitkan changePassword() punya iat PERSIS sama dengan stempel,
      // dan itu harus tetap sah.
      if (payload.iat * 1000 < user.passwordChangedAt.getTime()) {
        throw new UnauthorizedException(
          'Sesi ini sudah tidak berlaku karena password diganti — silakan login ulang',
        );
      }
    }

    return { sub: user.id, role: user.role, displayName: user.displayName };
  }
}
