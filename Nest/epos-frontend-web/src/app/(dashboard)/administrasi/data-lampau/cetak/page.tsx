import { requireSession } from '@/lib/server-api';
import { CetakLabelClient } from './cetak-label-client';

export default async function CetakLabelPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  await requireSession();
  return <CetakLabelClient ids={ids ?? ''} />;
}
