import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SupabaseAuthAdminService } from '../auth/supabase-auth-admin.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAdmin: SupabaseAuthAdminService,
  ) {}

  /**
   * Port dari Edge Function `admin-users` (action "create") — akun & password
   * sekarang murni milik Supabase Auth (schema.prisma User TIDAK punya kolom
   * password lagi, lihat komentar AuthService/SupabaseAuthAdminService).
   * Bikin lewat Admin API GoTrue dulu, lalu timpa profil `public.users` yang
   * sudah otomatis dibuat trigger `handle_new_user` (role default 'kasir')
   * dengan role & nama yang sebenarnya diminta admin — pola identik Edge
   * Function lama, cuma dipindah ke NestJS.
   */
  async create(dto: CreateUserDto, actorId: string) {
    const newId = await this.authAdmin.createUser(dto.email, dto.password, dto.displayName);

    let user;
    try {
      user = await this.prisma.user.update({
        where: { id: newId },
        data: { role: dto.role, displayName: dto.displayName, active: true },
      });
    } catch (err) {
      // Jangan tinggalkan akun auth yatim kalau timpa profilnya gagal
      // (sama alasan Edge Function lama menghapus balik akun auth-nya).
      await this.authAdmin.deleteUser(newId).catch(() => {});
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Trigger handle_new_user belum membuat profil — coba lagi');
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
   * gak tau, itu justru alasan fitur ini ada: staff lupa password. Password
   * ditulis lewat Admin API GoTrue (satu-satunya penyimpan password
   * sekarang, sama pola AuthService.changePassword) — TIDAK ADA lagi kolom
   * `password`/`passwordChangedAt` di public.users buat di-update.
   *
   * Batasan masa transisi (sama seperti AuthService.changePassword): JWT
   * yang sudah terbit tetap berlaku sampai kedaluwarsa, gak ada stempel buat
   * memaksa logout sesi lama.
   */
  async resetPassword(id: string, newPassword: string, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User tidak ditemukan');

    await this.authAdmin.updatePassword(id, newPassword);

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
      message: 'Password berhasil di-reset',
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

  /** Daftar teknisi aktif — dipakai kasir/admin milih technicianId pas
   * assign job (TechnicianJobsController.assign, role admin+kasir). Beda
   * dari findAll() (admin-only, semua role, ada email): ini cuma role
   * 'teknisi' + gak expose email ke kasir. */
  findTechnicians() {
    return this.prisma.user.findMany({
      where: { role: 'teknisi', active: true },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
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
