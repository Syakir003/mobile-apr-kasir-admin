import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, decodeSession } from '@/lib/session';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Semua fetch dari Client Component (TanStack Query, react-hook-form submit,
// dst) lewat sini: /api/proxy/<apapun-path-backend> -> diteruskan ke NestJS
// dengan header Authorization disisipkan dari cookie httpOnly di server.
// Browser JS sendiri gak pernah pegang token-nya — cuma manggil endpoint
// same-origin ini kayak manggil backend sendiri. Lihat lib/api-client.ts.
async function proxy(req: NextRequest, path: string[]) {
  const store = await cookies();
  const session = decodeSession(store.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ message: 'Sesi habis, silakan login ulang' }, { status: 401 });
  }

  const targetUrl = new URL(`/${path.join('/')}`, BACKEND_URL);
  targetUrl.search = req.nextUrl.search;

  const isBodyMethod = !['GET', 'HEAD'].includes(req.method);
  const contentType = req.headers.get('content-type') ?? '';
  const isMultipart = contentType.includes('multipart/form-data');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessToken}`,
  };
  // Content-Type multipart JANGAN di-set manual (boundary-nya harus ikut
  // apa adanya dari request asli) — biarin fetch() nge-handle sendiri kalau
  // body-nya FormData/stream.
  if (isBodyMethod && !isMultipart && contentType) {
    headers['Content-Type'] = contentType;
  }

  const backendRes = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: isBodyMethod ? req.body : undefined,
    // @ts-expect-error -- 'duplex' wajib buat streaming body di runtime fetch Next/undici, belum ada di tipe standar.
    duplex: isBodyMethod ? 'half' : undefined,
    cache: 'no-store',
  });

  const resHeaders = new Headers();
  const passthrough = backendRes.headers.get('content-type');
  if (passthrough) resHeaders.set('content-type', passthrough);

  return new NextResponse(backendRes.body, {
    status: backendRes.status,
    headers: resHeaders,
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path);
}
