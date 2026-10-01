import { requireSession } from '@/lib/server-api';
import { DataLampauClient } from './data-lampau-client';

export default async function DataLampauPage() {
  await requireSession();
  return <DataLampauClient />;
}
