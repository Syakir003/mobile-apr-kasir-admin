import { requireSession } from '@/lib/server-api';
import { ScanUnitClient } from './scan-client';

export default async function ScanUnitPage() {
  await requireSession();
  return <ScanUnitClient />;
}
