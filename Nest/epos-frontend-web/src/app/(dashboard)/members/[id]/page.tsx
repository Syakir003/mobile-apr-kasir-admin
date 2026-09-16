import { requireSession } from '@/lib/server-api';
import { MemberDetailClient } from './member-detail-client';

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession();
  return <MemberDetailClient memberId={id} />;
}
