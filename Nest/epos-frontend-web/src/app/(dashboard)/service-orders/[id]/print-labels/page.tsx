import { requireSession } from '@/lib/server-api';
import { UnitLabelsPrintClient } from './unit-labels-print-client';

export default async function UnitLabelsPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ units?: string }>;
}) {
  const { id } = await params;
  const { units } = await searchParams;
  await requireSession();
  // ?units=a,b = cetak hanya unit-unit itu (servis banyak AC yang sebagian unitnya sudah terlabel). Tanpa = semua unit order.
  const onlyUnitIds = units ? units.split(',').filter(Boolean) : undefined;
  return <UnitLabelsPrintClient serviceOrderId={id} onlyUnitIds={onlyUnitIds} />;
}
