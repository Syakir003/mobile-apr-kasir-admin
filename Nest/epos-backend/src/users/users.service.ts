import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { BCRYPT_ROUNDS, passwordChangeStamp } from '../common/password.util';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Port dari manageUser.ts lama — bedanya password WAJIB di-hash sendiri
   * (dulu Firebase Auth yang urus, sekarang kolom users.password kita yang pegang). */
  async create(dto: CreateUserDto, actorId: string) {
    const hashed = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashed,
          displayName: dto.displayName,
          role: dto.role,
          active: true,
        },
      });
    } catch (err) {
      // email @unique di schema — sebelumnya P2002 gak ditangkep, jatuh ke
      // HttpExceptionFilter (yang cuma @Catch(HttpException)) jadi 500
      // generik alih-alih 409 yang jelas buat admin ("email sudah dipakai").
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Email sudah dipakai user lain');
      }
      throw err;
    }
    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'user.create',
        target: user.id,
        detail: { role: dto.role },
      },
    });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
    };
  }

  /**
   * Aktif/nonaktifkan akun staff.
   *
   * DUA PENGAMAN ANTI-KUNCI-DIRI-SENDIRI (fix dari audit — sistem lama punya
   * dua-duanya di RPC `update_user_account`, dan dua-duanya gak keangkut pas
   * migrasi):
   *
   *   1. Admin gak boleh nonaktifin akunnya SENDIRI. Salah klik di layar
   *      daftar user langsung nendang dia keluar (JwtStrategy re-check
   *      `active` tiap request), dan kalau dia satu-satunya admin, gak ada
   *      lagi yang bisa ngidupin balik.
   *   2. Admin aktif TERAKHIR gak boleh dinonaktifin siapa pun. Dua admin
   *      yang saling nonaktifin gantian juga berakhir di kondisi yang sama:
   *      sistem tanpa admin, dan gak ada jalan balik selain nyolok DB manual.
   *
   * Dibungkus $transaction + advisory lock karena cek "masih ada admin aktif
   * lain gak?" lalu update itu read-then-write klasik: dua admin yang saling
   * dinonaktifin BARENGAN bisa dua-duanya lolos cek (masing-masing masih
   * ngeliat yang lain aktif), lalu dua-duanya commit — dan tinggal nol admin.
   * Advisory lock dipilih (bukan FOR UPDATE ke baris users) karena yang perlu
   * di-serialize itu "roster admin" secara keseluruhan, bukan satu baris
   * tertentu; polanya sama kayak MembersService.findOrCreate.
   */
  async toggleActive(id: string, active: boolean, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('users_admin_roster'))`;

      // findUnique dulu (bukan langsung update) — sebelumnya update() ke id
      // yang gak ada bikin PrismaClientKnownRequestError (P2025) yang gak
      // ketangkep HttpExceptionFilter, jatuh jadi 500 generik alih-alih 404
      // yang jelas.
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('User tidak ditemukan');

      if (!active) {
        if (id === actorId) {
          throw new ForbiddenException(
            'Gak bisa nonaktifin akun sendiri — minta admin lain yang lakuin',
          );
        }
        if (existing.role === 'admin' && existing.active) {
          const adminLain = await tx.user.count({
            where: { role: 'admin', active: true, id: { not: id } },
          });
          if (adminLain === 0) {
            throw new ForbiddenException(
              'Ini admin aktif terakhir — angkat admin lain dulu sebelum menonaktifkan akun ini',
            );
          }
        }
      }

      const user = await tx.user.update({ where: { id }, data: { active } });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'user.toggle_active',
          target: id,
          detail: { active },
        },
      });
      return { id: user.id, active: user.active };
    });
  }

  /**
   * Admin nge-reset password staff lain (padanan action `resetPassword` di
   * edge function admin-users lama). Gak minta password lama — admin emang
   * gak tau, itu justru alasan fitur ini ada: staff lupa password.
   *
   * `passwordChangedAt` ikut di-set biar semua sesi lama user itu langsung
   * mati (lihat JwtStrategy). Ini penting justru buat kasus paling umum
   * dipakainya: HP staff yang keluar kerja masih pegang token valid.
   */
  async resetPassword(id: string, newPassword: string, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User tidak ditemukan');

    await this.prisma.user.update({
      where: { id },
      data: {
        password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        passwordChangedAt: passwordChangeStamp(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'user.reset_password',
        target: id,
        // JANGAN pernah nyimpen passwordnya di sini, sekalipun ke-hash —
        // audit log dibaca admin, bukan tempat rahasia.
        detail: { email: existing.email, byAdmin: true },
      },
    });

    return {
      id,
      message:
        'Password berhasil di-reset — sesi lama user ini otomatis logout',
    };
  }

  findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Ganti role dan/atau nama tampilan — bagian `update_user_account` RPC
   * lama yang belum ke-port (gap dari audit migrasi). `active` sengaja TETAP
   * lewat endpoint terpisah (toggleActive di atas) biar pengaman
   * anti-kunci-diri-sendirinya gak bisa dilewatin lewat sini.
   *
   * PENGAMAN ADMIN-TERAKHIR dipakai lagi di sini (pola sama persis kayak
   * toggleActive): ganti role SELAIN admin buat admin aktif itu efeknya
   * sama kayak nonaktifin dia — role dibaca ulang dari DB tiap request
   * (lihat JwtStrategy.validate — role gak dipercaya dari klaim JWT), jadi
   * begitu di-update, request berikutnya orang itu langsung kehilangan akses
   * @Roles('admin') termasuk ke modul users ini sendiri. Kalau dia admin
   * TERAKHIR, gak ada jalan balik selain nyolok DB manual.
   */
  async update(id: string, dto: UpdateUserDto, actorId: string) {
    if (dto.role === undefined && dto.displayName === undefined) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.role !== undefined) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('users_admin_roster'))`;
      }

      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('User tidak ditemukan');

      const demotingActiveAdmin =
        dto.role !== undefined &&
        dto.role !== 'admin' &&
        existing.role === 'admin' &&
        existing.active;

      if (demotingActiveAdmin) {
        if (id === actorId) {
          throw new ForbiddenException(
            'Gak bisa ganti role akun sendiri keluar dari admin — minta admin lain yang lakuin',
          );
        }
        const adminLain = await tx.user.count({
          where: { role: 'admin', active: true, id: { not: id } },
        });
        if (adminLain === 0) {
          throw new ForbiddenException(
            'Ini admin aktif terakhir — angkat admin lain dulu sebelum ganti role akun ini',
          );
        }
      }

      const user = await tx.user.update({
        where: { id },
        data: {
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'user.update',
          target: id,
          detail: { role: dto.role, displayName: dto.displayName },
        },
      });

      return {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        active: user.active,
      };
    });
  }
}
