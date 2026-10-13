import { requireSession } from '@/lib/server-api';
import { MemberDetailClient } from './member-detail-client';

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  // Ubah tipe pembeli cuma admin (sama dengan PATCH /members/:id/price-tier).
  return <MemberDetailClient memberId={id} canEditTier={session.user.role === 'admin'} />;
}
