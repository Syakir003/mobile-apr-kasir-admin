import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, decodeSession, ROLE_HOME, type Role } from '@/lib/session';

// Rute per-prefix yang cuma boleh diakses role tertentu. Prefix yang gak
// disebut di sini (tapi tetap di dalam grup (dashboard)) berarti "semua role
// yang login boleh masuk" (mis. /dashboard/notifikasi kalau ada nanti).
const ROLE_PREFIXES: Array<{ prefix: string; roles: Role[] }> = [
  { prefix: '/pos', roles: ['kasir', 'admin'] },
  { prefix: '/teknisi', roles: ['teknisi', 'admin'] },
  { prefix: '/laporan', roles: ['admin'] },
  { prefix: '/pengaturan', roles: ['admin'] },
  { prefix: '/master', roles: ['admin'] },
];

const PUBLIC_PATHS = ['/login'];

// Next.js 16: file & fungsi ini WAJIB bernama 'proxy' (bukan 'middleware'
// lagi) — nama lama masih jalan tapi deprecated. Isinya tetap sama persis:
// guard auth+role sebelum request nyampe ke Server Component manapun.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const raw = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = decodeSession(raw);

  if (!session) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const restricted = ROLE_PREFIXES.find((r) => pathname.startsWith(r.prefix));
  if (restricted && !restricted.roles.includes(session.user.role)) {
    // Login tapi role gak cocok buat rute ini -> lempar ke "rumah" role-nya
    // sendiri, bukan ke /login (dia kan udah login).
    return NextResponse.redirect(new URL(ROLE_HOME[session.user.role], req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Jalan di semua path KECUALI asset statis Next & file publik.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)'],
};
