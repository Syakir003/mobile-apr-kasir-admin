import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, encodeSession, type SessionPayload } from '@/lib/session';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Proxy login: browser -> Route Handler ini -> NestJS /auth/login. Backend
// balikin { accessToken, user }; kita simpen APA ADANYA ke httpOnly cookie
// (gak pernah dikirim balik ke client sebagai JSON biasa). Ini satu-satunya
// tempat accessToken "lewat" — habis ini token cuma hidup di cookie.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ message: 'Email & password wajib diisi' }, { status: 400 });
  }

  const backendRes = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: 'no-store',
  });

  const data = await backendRes.json().catch(() => null);
  if (!backendRes.ok) {
    return NextResponse.json(
      { message: data?.message ?? 'Login gagal' },
      { status: backendRes.status },
    );
  }

  const session: SessionPayload = { accessToken: data.accessToken, user: data.user };
  const res = NextResponse.json({ user: session.user });
  res.cookies.set(SESSION_COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // Samain sama JWT_EXPIRES_IN backend (default 8h) — kalau beda, cookie
    // bisa lebih lama "hidup" dari token-nya (gak masalah, backend tetep
    // nolak token expired), atau lebih pendek (user dipaksa re-login lebih
    // cepat dari token expire — juga aman, cuma kurang nyaman).
    maxAge: 60 * 60 * 8,
  });
  return res;
}
