import { requireSession } from '@/lib/server-api';
import { JobReportPrintClient } from './job-report-print-client';

export default async function JobReportPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  return <JobReportPrintClient jobId={id} role={session.user.role} />;
}
