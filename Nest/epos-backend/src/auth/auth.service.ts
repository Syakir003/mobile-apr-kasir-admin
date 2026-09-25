import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseAuthAdminService } from './supabase-auth-admin.service';

/**
 * Masa transisi: identitas & password tetap milik Supabase Auth (auth.users),
 * karena aplikasi Flutter terpasang masih login ke Supabase. Login web
 * (POST /auth/login) memverifikasi password terhadap hash bcrypt di
 * auth.users (baca saja), lalu menerbitkan JWT NestJS (iss "epos-nest").
 * Role & status aktif selalu dari public.users (JwtStrategy.validate).
 * Cutover penuh (hash dipindah ke tabel milik Nest) dikerjakan belakangan.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly authAdmin: SupabaseAuthAdminService,
  ) {}

  // Hash dummy cuma buat nyamain waktu respons pas email gak ketemu (lihat
  // di bawah) — bukan password beneran siapa pun, gak ada makna khusus.
  private readonly DUMMY_HASH =
    '$2b$10$CwTycUXWue0Thq9StjUM0uJ8OoQC0/JD1U1U1U1U1U1U1U1U1U1U1';

  /** Hash bcrypt dari Supabase Auth; null bila akun auth tidak bisa login. */
  private async authHash(where: { email?: string; id?: string }): Promise<{ id: string; hash: string } | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ id: string; hash: string | null }[]>(
      `select id::text as id, encrypted_password as hash
         from auth.users
        where (($1::text is not null and lower(email) = lower($1)) or ($2::uuid is not null and id = $2::uuid))
          and deleted_at is null
          and (banned_until is null or banned_until < now())
        limit 1`,
      where.email ?? null,
      where.id ?? null,
    );
    const row = rows[0];
    return row?.hash ? { id: row.id, hash: row.hash } : null;
  }

  async login(email: string, password: string) {
    const auth = await this.authHash({ email });
    const user = auth ? await this.prisma.user.findUnique({ where: { id: auth.id } }) : null;
    if (!auth || !user || !user.active) {
      // Tetap jalankan bcrypt dengan hash dummy: waktu respons "email tidak
      // ada" harus sama dengan "password salah" (anti enumerasi email).
      await bcrypt.compare(password, this.DUMMY_HASH);
      throw new UnauthorizedException('Email atau password salah');
    }

    const valid = await bcrypt.compare(password, auth.hash);
    if (!valid) {
      throw new UnauthorizedException('Email atau password salah');
    }

    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, role: user.role }),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
      },
    };
  }

  /**
   * Ganti password sendiri — semua role. Password lama diverifikasi terhadap
   * auth.users, password baru ditulis lewat Admin API GoTrue (Supabase Auth
   * tetap satu-satunya penyimpan password, jadi login di aplikasi Flutter
   * ikut memakai password baru).
   *
   * Batasan masa transisi: JWT (Nest maupun Supabase) yang sudah terbit tetap
   * berlaku sampai kedaluwarsa — tidak ada lagi stempel passwordChangedAt
   * karena kolom itu tidak ada di skema Supabase.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const auth = await this.authHash({ id: userId });
    if (!user || !user.active || !auth) throw new UnauthorizedException('Akun tidak aktif');

    if (!(await bcrypt.compare(currentPassword, auth.hash))) {
      throw new UnauthorizedException('Password lama salah');
    }
    if (await bcrypt.compare(newPassword, auth.hash)) {
      throw new BadRequestException('Password baru harus beda dari yang lama');
    }

    await this.authAdmin.updatePassword(userId, newPassword);

    await this.prisma.auditLog.create({
      data: {
        actorUid: userId,
        action: 'user.change_password',
        target: userId,
        // Jangan pernah menyimpan password (lama/baru, ter-hash pun) di audit.
        detail: { self: true },
      },
    });

    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, role: user.role }),
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
