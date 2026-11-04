import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/server-api';
import { QueueLabelsPrintClient } from './queue-labels-print-client';

// Cetak QR banyak unit sekaligus dari daftar Job Teknisi (admin & kasir). Teknisi mencetak label lewat halaman jobnya
// sendiri (API label massal tidak terbuka untuk teknisi), jadi di sini dialihkan ke daftar job.
export default async function QueueLabelsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ units?: string }>;
}) {
  const session = await requireSession();
  if (session.user.role === 'teknisi') redirect('/teknisi/queue');
  const { units } = await searchParams;
  return <QueueLabelsPrintClient ids={units ?? ''} />;
}
