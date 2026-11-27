'use client';

import { useQuery } from '@tanstack/react-query';

/** Hanya untuk menampilkan tombol; izin sebenarnya tetap diperiksa server. */
export function useRole(): string | undefined {
  const { data } = useQuery({
    queryKey: ['session'],
    queryFn: async () => (await fetch('/api/auth/session')).json() as Promise<{ user: { role: string } | null }>,
    staleTime: 5 * 60_000,
  });
  return data?.user?.role;
}
