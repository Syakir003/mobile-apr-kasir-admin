import { requireSession } from '@/lib/server-api';
import { DeliveryNotePrintClient } from './delivery-note-print-client';

export default async function DeliveryNotePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession();
  return <DeliveryNotePrintClient serviceOrderId={id} />;
}
