import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { issuedBeforePasswordChange, type JwtPayload } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

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
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // Middleware (bukan di handleConnection): pemeriksaan ke DB harus selesai
  // sebelum client sempat mengirim 'join-admin-dashboard'.
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      const user = await this.authenticate(socket.handshake.auth?.token as string | undefined);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    });
  }

  // Aturan sama dengan JwtStrategy REST: sesi HP berumur 7 hari, jadi akun yang
  // dinonaktifkan atau ganti password harus ditolak di sini juga.
  private async authenticate(token: string | undefined): Promise<JwtPayload | null> {
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { active: true, role: true, passwordChangedAt: true },
      });
      if (!user?.active || issuedBeforePasswordChange(payload.iat, user.passwordChangedAt)) return null;
      return { sub: payload.sub, role: user.role as JwtPayload['role'] };
    } catch {
      return null;
    }
  }

  /** Putus semua koneksi satu user (akun dicabut / password diganti). */
  kick(userId: string) {
    this.server?.in(`user:${userId}`).disconnectSockets(true);
  }

  handleConnection(client: Socket) {
    const payload = client.data.user as JwtPayload | undefined;
    if (!payload) {
      client.disconnect(true);
      return;
    }

    // Siklus Notifikasi Push — tiap koneksi yang valid otomatis join room
    // pribadinya sendiri ('user:<uid>'). Beda dari room 'admin-dashboard'
    // (butuh join manual + gate role), room per-user ini gak butuh
    // approval apa pun karena isinya cuma notifikasi milik user itu
    // sendiri (setara notifications RLS `user_id = auth.uid()` di
    // Supabase lama) — dipakai NotificationsService.notify() buat push
    // notifikasi bell realtime ke web MAUPUN mobile begitu terkoneksi,
    // tanpa langkah subscribe tambahan di sisi client.
    client.join(`user:${payload.sub}`);
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
