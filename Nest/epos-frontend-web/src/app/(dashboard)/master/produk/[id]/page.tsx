import { requireSession } from '@/lib/server-api';
import { ProductDetailClient } from './product-detail-client';

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession();
  return <ProductDetailClient productId={id} />;
}
