import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, decodeSession } from '@/lib/session';

// Pengecualian SADAR dari prinsip "token gak pernah nyentuh JS": socket.io
// client di browser harus konek LANGSUNG ke backend (bukan diproksi lewat
// Next, websocket gak enak diproksi lewat Route Handler biasa), jadi dia
// butuh JWT buat handshake auth. Route ini baca httpOnly cookie di SERVER,
// lalu kasih token itu SEKALI ke client yang emang udah lolos middleware
// (artinya browser yang manggil ini sudah pasti browser yang sama yang
// nyimpen cookie httpOnly-nya, lewat request same-origin). Trade-off yang
// disengaja, bukan kebocoran desain — didokumentasikan di lib/socket.ts juga.
export async function GET() {
  const store = await cookies();
  const session = decodeSession(store.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ message: 'Belum login' }, { status: 401 });
  return NextResponse.json({ token: session.accessToken });
}
