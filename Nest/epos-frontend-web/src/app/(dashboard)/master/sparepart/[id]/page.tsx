import { requireSession } from '@/lib/server-api';
import { SparepartDetailClient } from './sparepart-detail-client';

export default async function SparepartDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireSession();
  return <SparepartDetailClient sparepartId={id} isAdmin={user.role === 'admin'} />;
}
