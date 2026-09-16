import { requireSession } from '@/lib/server-api';
import { InvoicePrintClient } from './invoice-print-client';

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession();
  return <InvoicePrintClient invoiceId={id} />;
}
