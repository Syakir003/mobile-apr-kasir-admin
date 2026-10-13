import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { FirebaseAdminService } from './firebase-admin.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import type { Role } from '../auth/decorators/roles.decorator';

/**
 * Siklus Notifikasi Push (2026-09). Satu-satunya "pintu masuk" buat bikin
 * notifikasi di seluruh sistem — service lain (job, material request, dll)
 * TIDAK pernah nulis langsung ke tabel `notifications`, selalu lewat
 * notify() di sini, biar 3 hal (baris DB + event realtime + push FCM)
 * selalu konsisten dikirim bareng dan gak ada yang lupa salah satu.
 *
 * Didesain dari awal buat dipakai IDENTIK oleh web maupun mobile (arahan
 * user: backend harus layak dipakai keduanya tanpa beda alur) — endpoint di
 * sini REST biasa + event Socket.IO room per-user, gak ada logic yang
 * spesifik ke satu client. Mobile nanti tinggal ganti FcmService.dart's
 * `_client.rpc('register_device_token', ...)` (Supabase) jadi
 * `POST /device-tokens` (endpoint ini) dengan payload yang sama persis.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly firebase: FirebaseAdminService,
  ) {}

  /**
   * Upsert by token (token sekarang @unique di schema — lihat migrasi
   * 20260915000000_device_token_unique). Kalau token yang sama sebelumnya
   * kepasang ke user lain (mis. logout lalu login user beda di HP sama),
   * otomatis pindah kepemilikan ke userId yang registrasi paling akhir.
   */
  async registerDeviceToken(userId: string, dto: RegisterDeviceTokenDto) {
    return this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      update: { userId, platform: dto.platform },
      create: { userId, token: dto.token, platform: dto.platform },
    });
  }

  /**
   * Dipanggil saat logout (FcmService.stop() lama). Sengaja di-scope ke
   * userId JUGA (bukan cuma token) — user A gak bisa unregister token milik
   * user B walau somehow tau token-nya.
   */
  async unregisterDeviceToken(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { ok: true };
  }

  async findAll(userId: string, query: NotificationsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where = {
      userId,
      ...(query.unreadOnly ? { read: false } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  /** Tanpa notificationId = tandai semua punya user ini terbaca (padanan RPC lama). */
  async markRead(userId: string, notificationId?: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false, ...(notificationId ? { id: notificationId } : {}) },
      data: { read: true },
    });
    return { ok: true };
  }

  /**
   * Helper inti dipanggil service lain setelah suatu aksi bisnis berhasil
   * (job ditugaskan, pengajuan material diputuskan, dst). Berurutan:
   * 1) simpan baris `notifications` (buat riwayat/bell + tetap ada walau
   *    device lagi offline pas dikirim),
   * 2) emit realtime ke room `user:<userId>` (bell update instan kalau lagi
   *    online — web maupun mobile SAMA cara terima-nya),
   * 3) kirim push FCM ke semua device token user itu (gagal aman kalau
   *    firebase-admin belum dikonfigurasi — lihat FirebaseAdminService).
   * Push gagal/skip TIDAK bikin notify() throw — baris notifikasi & event
   * realtime di atas sudah cukup buat UX inti, push cuma "bonus" pas app
   * ditutup.
   */
  async notify(
    userId: string,
    params: { title: string; body?: string; type: string; target?: string },
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title: params.title,
        body: params.body,
        type: params.type,
        target: params.target,
      },
    });

    this.realtime.emitToUser(userId, 'notification.new', notification);

    try {
      await this.pushToDevices(userId, params);
    } catch (e) {
      // Push gagal jangan sampai bikin flow bisnis pemanggil (assign job,
      // decide material request, dst) ikut gagal/rollback — cukup dicatat.
      this.logger.warn(`Push FCM gagal buat user ${userId}: ${e}`);
    }

    return notification;
  }

  /** notify() ke semua user AKTIF dengan salah satu role. Gak pernah throw —
   * dipanggil fire-and-forget dari alur bisnis (checkout, opname, dst). */
  async notifyRoles(
    roles: Role[],
    params: { title: string; body?: string; type: string; target?: string },
  ) {
    try {
      const users = await this.prisma.user.findMany({
        where: { role: { in: roles }, active: true },
        select: { id: true },
      });
      await Promise.all(users.map((u) => this.notify(u.id, params).catch(() => undefined)));
    } catch (e) {
      this.logger.warn(`notifyRoles gagal (${roles.join(',')}): ${e}`);
    }
  }

  /**
   * Cek sparepart yang barusan berkurang stoknya; kalau sisa <= minStock
   * (minStock > 0) kabari admin + gudang. Dedup: selama masih ada notifikasi
   * 'stok_menipis' BELUM DIBACA untuk sparepart yang sama, gak dikirim lagi
   * (biar tiap penjualan gak spam).
   */
  async notifyLowStock(sparepartIds: string[]) {
    if (sparepartIds.length === 0) return;
    try {
      const low = await this.prisma.$queryRaw<{ id: string; name: string; stock: string; unit: string }[]>`
        SELECT id, name, stock, unit FROM spareparts
        WHERE id = ANY(${sparepartIds}::text[]) AND min_stock > 0 AND stock <= min_stock
      `;
      for (const sp of low) {
        const already = await this.prisma.notification.findFirst({
          where: { type: 'stok_menipis', target: sp.id, read: false },
          select: { id: true },
        });
        if (already) continue;
        await this.notifyRoles(['admin', 'gudang'], {
          title: 'Stok Sparepart Menipis',
          body: `${sp.name} tersisa ${Number(sp.stock)} ${sp.unit} (di bawah batas minimum).`,
          type: 'stok_menipis',
          target: sp.id,
        });
      }
    } catch (e) {
      this.logger.warn(`notifyLowStock gagal: ${e}`);
    }
  }

  private async pushToDevices(
    userId: string,
    params: { title: string; body?: string; type: string; target?: string },
  ) {
    if (!this.firebase.isConfigured()) return;

    const devices = await this.prisma.deviceToken.findMany({ where: { userId } });
    if (devices.length === 0) return;

    const { invalidTokens } = await this.firebase.sendMulticast(
      devices.map((d) => d.token),
      { title: params.title, body: params.body },
      { type: params.type, target: params.target ?? '' },
    );

    // Token yang FCM bilang udah gak valid (uninstall/reset) — bersihin
    // biar percobaan kirim berikutnya gak nyoba token mati terus-terusan.
    if (invalidTokens.length > 0) {
      await this.prisma.deviceToken.deleteMany({
        where: { token: { in: invalidTokens } },
      });
    }
  }
}
