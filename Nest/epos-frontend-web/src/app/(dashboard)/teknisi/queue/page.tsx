import { requireSession } from '@/lib/server-api';
import { TeknisiQueueClient } from './queue-client';

// Server Component tipis: cuma buat baca role dari session (httpOnly cookie,
// gak bisa dibaca dari Client Component) lalu diturunkan sebagai prop.
// Logika fetching & UI beneran ada di queue-client.tsx.
export default async function TeknisiQueuePage() {
  const session = await requireSession();
  return <TeknisiQueueClient role={session.user.role} />;
}
