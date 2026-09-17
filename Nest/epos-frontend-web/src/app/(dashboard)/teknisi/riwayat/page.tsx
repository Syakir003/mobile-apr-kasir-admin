import { requireSession } from '@/lib/server-api';
import { RiwayatClient } from './riwayat-client';

export default async function TeknisiRiwayatPage() {
  const session = await requireSession();
  return <RiwayatClient role={session.user.role} />;
}
