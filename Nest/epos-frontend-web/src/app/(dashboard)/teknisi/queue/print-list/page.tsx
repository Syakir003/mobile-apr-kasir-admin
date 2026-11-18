import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/server-api';
import { JobListPrintClient } from './job-list-print-client';

// Cetak daftar pekerjaan servis (tanpa nama teknisi) dari Antrian Servis, difilter tanggal. Khusus admin & kasir:
// teknisi hanya melihat job miliknya lewat daftar job, jadi dialihkan ke sana.
export default async function JobListPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string; q?: string; teknisi?: string }>;
}) {
  const session = await requireSession();
  if (session.user.role === 'teknisi') redirect('/teknisi/queue');
  const { from, to, status, q, teknisi } = await searchParams;
  return (
    <JobListPrintClient
      initialFrom={from ?? ''}
      initialTo={to ?? ''}
      initialStatus={status === 'selesai' || status === 'review' || status === 'semua' ? status : 'aktif'}
      initialTechnician={teknisi ?? 'all'}
      initialQuery={q ?? ''}
    />
  );
}
