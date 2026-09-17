import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, decodeSession, encodeSession, type SessionPayload } from '@/lib/session';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Ganti password SENDIRI (halaman Profil) -> PATCH /auth/me/password.
// Beda dari proxy generik (app/api/proxy/[...path]/route.ts) karena endpoint
// ini balikin accessToken BARU (backend nge-stamp passwordChangedAt, jadi
// JWT lama otomatis invalid di request berikutnya -- lihat JwtStrategy.validate).
// Kalau lewat proxy biasa, token baru itu bakal ke-expose ke JS client DAN
// cookie sesi gak ke-update -> user auto-kelempar "sesi habis" abis sukses
// ganti password sendiri. Jadi di sini kita yang nulis ulang cookie-nya.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.currentPassword || !body?.newPassword) {
    return NextResponse.json(
      { message: 'Password lama & password baru wajib diisi' },
      { status: 400 },
    );
  }

  const store = await cookies();
  const session = decodeSession(store.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ message: 'Sesi habis, silakan login ulang' }, { status: 401 });
  }

  const backendRes = await fetch(`${BACKEND_URL}/auth/me/password`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    }),
    cache: 'no-store',
  });

  const data = await backendRes.json().catch(() => null);
  if (!backendRes.ok) {
    return NextResponse.json(
      { message: data?.message ?? 'Gagal mengubah password' },
      { status: backendRes.status },
    );
  }

  const newSession: SessionPayload = { accessToken: data.accessToken, user: data.user };
  const res = NextResponse.json({ user: newSession.user });
  res.cookies.set(SESSION_COOKIE_NAME, encodeSession(newSession), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return res;
}
