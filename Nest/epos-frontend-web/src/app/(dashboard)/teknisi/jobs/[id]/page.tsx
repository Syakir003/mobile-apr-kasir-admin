import { requireSession } from '@/lib/server-api';
import { setoranQueueHref } from '../../../setoran/setoran-shared';
import { JobDetailClient } from './job-detail-client';

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ setoran?: string; technicianId?: string }>;
}) {
  const { id } = await params;
  const { setoran, technicianId } = await searchParams;
  const session = await requireSession();
  // ?setoran=1 (dari tab Setoran Teknisi di Antrian Servis): panel Aksi admin diganti verifikasi setoran. technicianId =
  // filter teknisi tab itu, dibawa supaya tombol Kembali memulihkan pilihan yang sama.
  return (
    <JobDetailClient
      jobId={id}
      role={session.user.role}
      setoranBack={setoran === '1' ? setoranQueueHref(technicianId) : undefined}
    />
  );
}
