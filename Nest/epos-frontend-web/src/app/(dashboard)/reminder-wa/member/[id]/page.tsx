import { requireSession } from '@/lib/server-api';
import { MemberScheduleClient } from './member-schedule-client';

export default async function MemberSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession();
  return <MemberScheduleClient memberId={id} />;
}
