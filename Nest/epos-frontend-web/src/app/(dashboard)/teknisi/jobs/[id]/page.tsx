import { requireSession } from '@/lib/server-api';
import { JobDetailClient } from './job-detail-client';

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  return <JobDetailClient jobId={id} role={session.user.role} />;
}
