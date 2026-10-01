import { requireSession } from '@/lib/server-api';
import { KasirScanClient } from './kasir-scan-client';

export default async function KasirScanPage() {
  await requireSession();
  return <KasirScanClient />;
}
