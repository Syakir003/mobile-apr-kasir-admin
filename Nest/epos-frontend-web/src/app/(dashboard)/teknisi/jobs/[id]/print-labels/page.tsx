import { requireSession } from '@/lib/server-api';
import { UnitLabelsPrintClient } from '@/app/(dashboard)/service-orders/[id]/print-labels/unit-labels-print-client';

// Cetak label QR dari halaman job TEKNISI (mis. AC tanpa label yang baru ditambahkan di tengah servis). Halaman cetak
// order untuk admin/kasir tidak bisa dipakai teknisi (datanya GET /service-orders/:id, 403 untuk teknisi), jadi data
// label diambil lewat job milik teknisi itu.
export default async function TeknisiUnitLabelsPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ units?: string }>;
}) {
  const { id } = await params;
  const { units } = await searchParams;
  await requireSession();
  // ?units=a,b = cetak hanya unit-unit itu. Tanpa = semua unit order milik teknisi ini.
  const onlyUnitIds = units ? units.split(',').filter(Boolean) : undefined;
  return <UnitLabelsPrintClient jobId={id} onlyUnitIds={onlyUnitIds} />;
}
