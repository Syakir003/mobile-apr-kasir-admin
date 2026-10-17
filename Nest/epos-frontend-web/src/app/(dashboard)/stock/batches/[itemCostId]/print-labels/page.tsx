import { requireSession } from '@/lib/server-api';
import { StockUnitLabelsPrintClient } from './stock-unit-labels-print-client';

export default async function StockUnitLabelsPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemCostId: string }>;
  // ?unit=<id unit> = langsung pilih satu unit saja (dari tampilan "Per Unit").
  searchParams: Promise<{ unit?: string }>;
}) {
  const { itemCostId } = await params;
  const { unit } = await searchParams;
  await requireSession();
  return <StockUnitLabelsPrintClient itemCostId={itemCostId} initialUnitId={unit} />;
}
