import { requireSession } from '@/lib/server-api';
import { UnitLabelsPrintClient } from './unit-labels-print-client';

export default async function UnitLabelsPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession();
  return <UnitLabelsPrintClient serviceOrderId={id} />;
}
