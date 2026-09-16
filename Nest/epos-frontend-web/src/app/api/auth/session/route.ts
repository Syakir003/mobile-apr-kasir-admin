import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, decodeSession } from '@/lib/session';

// Dipanggil Client Component (mis. nav shell) buat tau siapa yang login &
// role-nya, TANPA pernah expose accessToken-nya sendiri ke JS.
export async function GET() {
  const store = await cookies();
  const session = decodeSession(store.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: session.user });
}
