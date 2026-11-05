import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, decodeSession, encodeSession, type SessionPayload } from '@/lib/session';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Ganti foto profil SENDIRI -> POST /auth/me/avatar (multipart, field `photo`).
// Tidak lewat proxy generik karena `user` di cookie sesi harus ikut diperbarui
// (sidebar & halaman Profil membaca avatarPath dari cookie) — pola sama dengan
// app/api/auth/change-password/route.ts. Token tidak berubah.
export async function POST(req: NextRequest) {
  const store = await cookies();
  const session = decodeSession(store.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ message: 'Sesi habis, silakan login ulang' }, { status: 401 });
  }
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) {
    return NextResponse.json({ message: 'Origin tidak diizinkan' }, { status: 403 });
  }

  const backendRes = await fetch(`${BACKEND_URL}/auth/me/avatar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      // Boundary multipart ada di header ini; body diteruskan sebagai stream.
      'Content-Type': req.headers.get('content-type') ?? '',
    },
    body: req.body,
    // @ts-expect-error -- 'duplex' wajib buat streaming body di fetch Next/undici, belum ada di tipe standar.
    duplex: 'half',
    cache: 'no-store',
  });

  const data = await backendRes.json().catch(() => null);
  if (!backendRes.ok) {
    return NextResponse.json(
      { message: data?.message ?? 'Gagal mengganti foto profil' },
      { status: backendRes.status },
    );
  }

  const newSession: SessionPayload = { accessToken: session.accessToken, user: data };
  const res = NextResponse.json({ user: data });
  res.cookies.set(SESSION_COOKIE_NAME, encodeSession(newSession), {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return res;
}
