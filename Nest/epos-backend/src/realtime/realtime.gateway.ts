import {
  ConnectedSocket,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

/**
 * Pengganti listener realtime Firestore lama / Supabase Realtime. Di sini
 * event di-emit MANUAL dari tiap service setelah operasi penting berhasil
 * (transaction.created, job.status_changed, invoice.updated) — bukan
 * otomatis dari trigger DB.
 *
 * SOAL AUTH (fix dari audit): sebelumnya endpoint 'join-admin-dashboard' bisa
 * dipanggil siapa saja tanpa validasi apa pun — origin manapun (CORS '*')
 * bisa connect & nguping semua event bisnis (nilai transaksi, status job,
 * dsb). Sekarang tiap koneksi socket WAJIB bawa JWT valid (sama seperti REST,
 * lihat lib/socket.ts di frontend yang ambil token sekali-pakai dari
 * /api/auth/socket-token) di `handshake.auth.token`, dicek di
 * handleConnection() — kalau invalid langsung didisconnect sebelum sempat
 * subscribe event apa pun. Room 'admin-dashboard' sendiri dibatasi role
 * 'admin' aja (dashboard admin, bukan buat kasir/teknisi).
 */
@WebSocketGateway({
  // FRONTEND_ORIGIN boleh diisi multiple origin dipisah koma (mis. buat
  // staging+prod sekaligus). Fallback ke port dev Next.js (3001) kalau env
  // belum diisi — TETAP HARUS diisi eksplisit pas production, jangan andalin
  // fallback ini (beda dari JWT_SECRET yang sengaja bikin app refuse start,
  // ini fallback longgar dulu supaya gak nge-block dev lokal).
  cors: {
    origin: process.env.FRONTEND_ORIGIN?.split(',').map((o) => o.trim()) ?? [
      'http://localhost:3001',
    ],
  },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      // Simpan payload di socket buat dipakai handler lain (mis. cek role
      // sebelum join room) — TIDAK re-check `active` ke DB tiap koneksi
      // socket (beda dari JwtStrategy REST) karena socket ini cuma dipakai
      // buat notifikasi read-only, bukan aksi yang butuh state akun terkini
      // detik-ke-detik; koneksi lama otomatis putus begitu client reconnect
      // dengan token baru (token socket-nya sendiri short-lived, lihat
      // /api/auth/socket-token di frontend).
      client.data.user = payload;

      // Siklus Notifikasi Push — tiap koneksi yang valid otomatis join room
      // pribadinya sendiri ('user:<uid>'). Beda dari room 'admin-dashboard'
      // (butuh join manual + gate role), room per-user ini gak butuh
      // approval apa pun karena isinya cuma notifikasi milik user itu
      // sendiri (setara notifications RLS `user_id = auth.uid()` di
      // Supabase lama) — dipakai NotificationsService.notify() buat push
      // notifikasi bell realtime ke web MAUPUN mobile begitu terkoneksi,
      // tanpa langkah subscribe tambahan di sisi client.
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  emitToAdmin(event: string, payload: unknown) {
    this.server?.to('admin-dashboard').emit(event, payload);
  }

  /** Kirim event realtime ke satu user spesifik (semua device/tab yang lagi konek). */
  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  @SubscribeMessage('join-admin-dashboard')
  handleJoin(@ConnectedSocket() client: Socket) {
    const user = client.data.user as JwtPayload | undefined;
    if (!user || user.role !== 'admin') {
      // Bukan admin (atau somehow lolos handleConnection tanpa payload) —
      // tolak join, JANGAN silent-ignore (biar keliatan jelas di client
      // kalau join-nya ditolak, bukan diem-diem gak dapet event).
      client.emit('join-admin-dashboard:error', { message: 'Akses ditolak' });
      return;
    }
    client.join('admin-dashboard');
  }
}
