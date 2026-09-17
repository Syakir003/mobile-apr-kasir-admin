import { requireSession } from '@/lib/server-api';
import { TeknisiDashboardClient } from './dashboard-client';

// Server Component tipis — sama pola persis kayak teknisi/queue/page.tsx &
// teknisi/riwayat/page.tsx: cuma baca session (httpOnly cookie) lalu
// diturunkan sebagai prop, logika fetching & UI beneran di dashboard-client.tsx.
export default async function TeknisiDashboardPage() {
  const session = await requireSession();
  return <TeknisiDashboardClient role={session.user.role} displayName={session.user.displayName} />;
}
