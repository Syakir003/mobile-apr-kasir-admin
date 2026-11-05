import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { SESSION_COOKIE_NAME, decodeSession, type SessionPayload, type SessionUser } from '@/lib/session';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Dipakai dari Server Component / Server Action — manggil backend LANGSUNG
// (skip proxy, gak ada browser yang terlibat di sini) pakai token dari
// cookie httpOnly. Cocok buat initial data page (mis. daftar produk di
// halaman master data) yang di-fetch pas render pertama di server.
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE_NAME)?.value);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/**
 * User sesi + nama & foto TERBARU dari GET /auth/me. Cookie hanya diisi saat
 * login, jadi foto yang diganti dari HP/browser lain tidak akan kelihatan
 * tanpa ini. Gagal (backend mati dsb.) = pakai isi cookie apa adanya.
 * Role tetap dari cookie, sama dengan yang dipakai proxy.ts untuk guard rute.
 */
export const currentUser = cache(async (): Promise<SessionUser> => {
  const { user } = await requireSession();
  try {
    const me = await serverFetch<{ displayName: string; avatarPath: string | null }>('/auth/me');
    return { ...user, displayName: me.displayName, avatarPath: me.avatarPath };
  } catch {
    return user;
  }
});

export async function serverFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await requireSession();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message ?? `Gagal memuat data (${res.status})`);
  }
  return res.json() as Promise<T>;
}
