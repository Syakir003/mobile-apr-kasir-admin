import { requireSession } from '@/lib/server-api';
import { TeknisiQueueClient } from './queue-client';

// Server Component tipis: cuma buat baca role dari session (httpOnly cookie,
// gak bisa dibaca dari Client Component) lalu diturunkan sebagai prop.
// Logika fetching & UI beneran ada di queue-client.tsx.
// ?tab=setoran&technicianId=<id> = tujuan notifikasi bel (uang tertahan / pembayaran baru), hanya berarti untuk admin.
export default async function TeknisiQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; technicianId?: string }>;
}) {
  const { tab, technicianId } = await searchParams;
  const session = await requireSession();
  const initialTab = tab === 'setoran' ? 'setoran' : 'job';
  // key: bila admin sedang di antrian lalu menekan notifikasi (parameter URL berubah), komponen dipasang ulang.
  return (
    <TeknisiQueueClient
      key={`${initialTab}:${technicianId ?? ''}`}
      role={session.user.role}
      initialTab={initialTab}
      initialTechnicianId={technicianId ?? ''}
    />
  );
}
