'use client';

// Dipakai dari Client Component (TanStack Query hooks, form submit, dll).
// Selalu manggil /api/proxy/* (same-origin) — TIDAK PERNAH langsung ke
// BACKEND_URL, karena browser gak punya accessToken (itu di httpOnly cookie,
// cuma bisa dibaca server). Lihat app/api/proxy/[...path]/route.ts.

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init.headers,
    },
  });

  if (res.status === 401) {
    // Sesi habis di tengah pemakaian -> lempar ke login, bawa balik path
    // sekarang biar abis login user gak kehilangan konteks.
    if (typeof window !== 'undefined') {
      // Sengaja full page reload (bukan router.push) — ini modul biasa, bukan
      // komponen, jadi gak ada akses ke useRouter(). Full reload juga
      // sekalian ngebersihin state client yang mungkin udah basi gara-gara
      // sesi habis di tengah pemakaian.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(401, 'Sesi habis');
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? 'Terjadi kesalahan', data);
  }
  return data as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
