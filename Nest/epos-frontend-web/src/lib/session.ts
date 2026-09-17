// Bentuk data session yang disimpan di httpOnly cookie, dipakai bareng
// oleh middleware.ts dan semua Route Handler di app/api/auth/*.
//
// Kenapa httpOnly cookie (bukan localStorage): accessToken JWT gak pernah
// nyentuh JS di browser sama sekali — Server Component & Route Handler yang
// baca cookie ini di server lalu nyisipin `Authorization: Bearer` pas
// manggil backend NestJS. Konsekuensinya: kalau ada fitur yang MESTI jalan
// di browser (mis. koneksi socket.io langsung ke backend), harus lewat jalur
// khusus — lihat app/api/auth/socket-token/route.ts.

export const SESSION_COOKIE_NAME = 'epos_session';

export type Role = 'admin' | 'kasir' | 'teknisi';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  displayName: string;
}

export interface SessionPayload {
  accessToken: string;
  user: SessionUser;
}

// Next.js API route response backend /auth/login: { accessToken, user }.
export function encodeSession(payload: SessionPayload): string {
  return JSON.stringify(payload);
}

export function decodeSession(raw: string | undefined): SessionPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionPayload;
    if (!parsed?.accessToken || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Halaman mana yang boleh diakses role apa — dipakai middleware.ts buat
// nge-guard grup (dashboard). '*' berarti semua role login boleh masuk.
export const ROLE_HOME: Record<Role, string> = {
  admin: '/dashboard',
  kasir: '/pos',
  teknisi: '/teknisi/dashboard',
};
