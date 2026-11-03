import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Foto pengerjaan untuk halaman struk publik (tanpa login, lihat PUBLIC_PATHS di proxy.ts). Backend hanya
// menyerahkan foto yang memang milik nota dengan token ini; token + id foto di URL adalah satu-satunya pelindung.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; photoId: string }> }) {
  const { token, photoId } = await ctx.params;
  const res = await fetch(
    `${BACKEND_URL}/public/receipt/${encodeURIComponent(token)}/photo/${encodeURIComponent(photoId)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    return new NextResponse('Foto tidak ditemukan', { status: res.status === 404 ? 404 : 502 });
  }
  return new NextResponse(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
