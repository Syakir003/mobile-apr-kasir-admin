import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { BCRYPT_ROUNDS, passwordChangeStamp } from '../common/password.util';

/**
 * Pengganti custom_access_token_hook Supabase (role disisipkan ke JWT dari
 * public.users). Di sini roleny disisipkan langsung saat sign JWT sendiri.
 * Bedanya dengan Supabase: JWT self-contained (gak bisa "dicabut" sebelum
 * expired) — user yang di-nonaktifkan admin baru kena efek begitu token lama
 * expired dan dia coba login ulang, atau begitu request berikutnya lewat
 * JwtStrategy.validate() yang re-check `active` ke DB (lihat jwt.strategy.ts).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Hash dummy cuma buat nyamain waktu respons pas email gak ketemu (lihat
  // di bawah) — bukan password beneran siapa pun, gak ada makna khusus.
  private readonly DUMMY_HASH =
    '$2b$10$CwTycUXWue0Thq9StjUM0uJ8OoQC0/JD1U1U1U1U1U1U1U1U1U1U1';

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      // Sebelumnya langsung return di sini TANPA jalanin bcrypt.compare sama
      // sekali — beda waktu respons antara "email gak ada" (cepet) vs "email
      // ada tapi password salah" (lambat, nunggu bcrypt) itu measurable dan
      // bisa dipakai buat nge-enumerate email staff yang valid dari luar,
      // walau pesan errornya sama-sama "Email atau password salah". Tetap
      // jalanin bcrypt.compare pakai dummy hash biar waktunya senormal
      // kasus password salah.
      await bcrypt.compare(password, this.DUMMY_HASH);
      throw new UnauthorizedException('Email atau password salah');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const payload = { sub: user.id, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
      },
    };
  }

  /**
   * Ganti password sendiri — SEMUA role (kasir/teknisi/admin), bukan cuma
   * admin. Sebelumnya endpoint ini gak ada sama sekali: layar Profil di app
   * Flutter lama manggil `auth.updateUser()` punya Supabase, dan itu ikut
   * hilang pas pindah ke backend sendiri, jadi gak ada satu pun cara buat
   * siapa pun ganti password.
   *
   * Sengaja balikin `accessToken` BARU: `passwordChangedAt` yang di-set di
   * sini bikin semua token lama (termasuk yang lagi dipakai buat manggil
   * endpoint ini) ditolak JwtStrategy. Tanpa token pengganti, user langsung
   * ke-logout tiap kali ganti password — bener secara keamanan tapi bikin
   * bingung. Token baru punya `iat` >= stempel, jadi dia lolos.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // JwtAuthGuard udah mastiin user-nya ada & aktif, jadi ini pengaman
    // ekstra buat kasus akun kehapus di tengah request.
    if (!user || !user.active)
      throw new UnauthorizedException('Akun tidak aktif');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new UnauthorizedException('Password lama salah');

    // Cegah "ganti" ke password yang sama persis — bukan soal keamanan, tapi
    // biar user gak ngira udah aman padahal gak ada yang berubah (dan biar
    // stempel passwordChangedAt gak nendang sesi tanpa alasan).
    if (await bcrypt.compare(newPassword, user.password)) {
      throw new BadRequestException('Password baru harus beda dari yang lama');
    }

    const changedAt = passwordChangeStamp();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        passwordChangedAt: changedAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUid: userId,
        action: 'user.change_password',
        target: userId,
        // JANGAN pernah nyimpen password (lama maupun baru) di detail audit,
        // sekalipun ke-hash — audit log dibaca admin, bukan tempat rahasia.
        detail: { self: true },
      },
    });

    const payload = { sub: user.id, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
      },
    };
  }

  /** Profil sendiri (GET /auth/me) — semua role. `userId` SELALU dari `sub`
   * di JWT, gak pernah dari param URL, jadi endpoint ini gak bisa dipakai
   * ngintip user lain. */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    return user;
  }
}
