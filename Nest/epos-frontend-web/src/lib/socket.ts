'use client';

import { io, type Socket } from 'socket.io-client';

const BACKEND_WS_URL =
  process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? 'http://localhost:3000';

let socket: Socket | null = null;
let connecting: Promise<Socket> | null = null;

// Realtime job.status_changed dkk (RealtimeGateway di backend) — koneksi
// LANGSUNG browser -> backend (bukan lewat proxy Next, websocket gak cocok
// diproksi Route Handler biasa). Makanya butuh token via
// /api/auth/socket-token dulu (lihat komentar di route itu buat alasannya).
export async function getSocket(): Promise<Socket> {
  if (socket?.connected) return socket;
  if (connecting) return connecting;

  connecting = (async () => {
    const res = await fetch('/api/auth/socket-token');
    if (!res.ok) throw new Error('Gagal ambil token realtime — belum login?');
    const { token } = (await res.json()) as { token: string };

    socket = io(BACKEND_WS_URL, {
      auth: { token },
      transports: ['websocket'],
    });
    return socket;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
