import { requireSession } from '@/lib/server-api';
import { JobDetailClient } from './job-detail-client';

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ setoran?: string }>;
}) {
  const { id } = await params;
  const { setoran } = await searchParams;
  const session = await requireSession();
  // ?setoran=1 (dari tab Setoran Teknisi di Antrian Servis): panel Aksi admin diganti verifikasi setoran.
  return <JobDetailClient jobId={id} role={session.user.role} setoranMode={setoran === '1'} />;
}
