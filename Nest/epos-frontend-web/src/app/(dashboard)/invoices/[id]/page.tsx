import { requireSession } from '@/lib/server-api';
import { InvoiceDetailClient } from './invoice-detail-client';

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession();
  return <InvoiceDetailClient invoiceId={id} />;
}
