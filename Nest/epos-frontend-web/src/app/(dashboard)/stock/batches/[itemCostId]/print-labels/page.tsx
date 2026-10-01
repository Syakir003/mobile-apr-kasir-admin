import { requireSession } from '@/lib/server-api';
import { StockUnitLabelsPrintClient } from './stock-unit-labels-print-client';

export default async function StockUnitLabelsPrintPage({
  params,
}: {
  params: Promise<{ itemCostId: string }>;
}) {
  const { itemCostId } = await params;
  await requireSession();
  return <StockUnitLabelsPrintClient itemCostId={itemCostId} />;
}
