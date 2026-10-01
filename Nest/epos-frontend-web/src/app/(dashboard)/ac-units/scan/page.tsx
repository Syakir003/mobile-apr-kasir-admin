import { requireSession } from '@/lib/server-api';
import { ScanUnitClient } from './scan-client';

export default async function ScanUnitPage() {
  const session = await requireSession();
  return <ScanUnitClient role={session.user.role} />;
}
