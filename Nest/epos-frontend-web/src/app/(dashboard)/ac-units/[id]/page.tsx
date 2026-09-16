import { requireSession } from '@/lib/server-api';
import { AcUnitDetailClient } from './ac-unit-detail-client';

export default async function AcUnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  return <AcUnitDetailClient unitId={id} role={session.user.role} />;
}
