import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

/**
 * Wrapper firebase-admin — padanan sisi-server dari FcmService.dart (yang
 * jalan di device). Di app mobile lama, kirim push BENERAN-nya kemungkinan
 * dipicu Postgres trigger + Supabase Edge Function (gak kelihatan dari kode
 * Flutter, cuma register/unregister token yang keliatan) — di sini
 * digantikan pemanggilan eksplisit dari NotificationsService.notify()
 * setelah baris `notifications` dibuat.
 *
 * SENGAJA didesain "gagal aman": kalau env var kredensial belum diisi (mis.
 * pas awal setup sebelum service account key dari Firebase Console
 * didapat), service ini nonaktif diam-diam (isConfigured()=false) — bukan
 * nge-crash start aplikasi. Baris `notifications` + event realtime
 * (RealtimeGateway.emitToUser, buat bell in-app) TETAP jalan normal,
 * cuma push HP-nya yang belum terkirim sampai kredensial diisi.
 */
@Injectable()
export class FirebaseAdminService {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private app: admin.app.App | null = null;
  private warnedOnce = false;

  /** Lazy-init — dipanggil tiap mau kirim, TAPI cuma bener-bener init sekali. */
  private getApp(): admin.app.App | null {
    if (this.app) return this.app;
    if (admin.apps.length > 0) {
      this.app = admin.apps[0] as admin.app.App;
      return this.app;
    }

    // Isi env ini dengan JSON lengkap service account key (Firebase Console
    // -> Project Settings -> Service Accounts -> Generate new private key),
    // di-stringify jadi satu baris. Belum diisi = push nonaktif (lihat
    // komentar class di atas).
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;

    try {
      const serviceAccount = JSON.parse(raw);
      this.app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      return this.app;
    } catch (e) {
      this.logger.error(
        `FIREBASE_SERVICE_ACCOUNT_JSON gak valid, push FCM nonaktif: ${e}`,
      );
      return null;
    }
  }

  isConfigured(): boolean {
    return this.getApp() !== null;
  }

  /**
   * Kirim ke banyak token sekaligus. Token yang udah gak valid/expired
   * (unregistered-error dari FCM) DIHAPUS dari device_tokens oleh pemanggil
   * (NotificationsService), bukan di sini — biar service ini fokus cuma
   * urusan kirim, gak nyentuh Prisma.
   */
  async sendMulticast(
    tokens: string[],
    notification: { title: string; body?: string },
    data?: Record<string, string>,
  ): Promise<{ invalidTokens: string[] }> {
    const app = this.getApp();
    if (!app) {
      if (!this.warnedOnce) {
        this.logger.warn(
          'FIREBASE_SERVICE_ACCOUNT_JSON belum diisi — notifikasi push FCM di-skip (baris `notifications` & event realtime tetap jalan normal).',
        );
        this.warnedOnce = true;
      }
      return { invalidTokens: [] };
    }
    if (tokens.length === 0) return { invalidTokens: [] };

    const res = await admin.messaging(app).sendEachForMulticast({
      tokens,
      notification: { title: notification.title, body: notification.body },
      data,
    });

    const invalidTokens: string[] = [];
    res.responses.forEach((r, i) => {
      if (
        !r.success &&
        (r.error?.code === 'messaging/registration-token-not-registered' ||
          r.error?.code === 'messaging/invalid-registration-token')
      ) {
        invalidTokens.push(tokens[i]);
      }
    });
    return { invalidTokens };
  }
}
