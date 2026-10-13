import { requireSession } from '@/lib/server-api';
import { StokPrintClient } from './stok-print-client';

export default async function StokPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; kind?: string; brand?: string; semua?: string }>;
}) {
  const { from, to, kind, brand, semua } = await searchParams;
  await requireSession();
  return <StokPrintClient from={from ?? ''} to={to ?? ''} kind={kind} brand={brand} showEmpty={semua === '1'} />;
}
