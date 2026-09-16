import { requireSession } from '@/lib/server-api';
import { ServiceIntakeClient } from './intake-client';

// Server Component tipis: cuma baca role dari session (httpOnly cookie) buat
// nentuin apakah dropdown "Teknisi" ditampilkan (GET /users admin-only di
// backend) — sama pola persis kayak teknisi/queue/page.tsx.
export default async function ServiceIntakePage() {
  const session = await requireSession();
  return <ServiceIntakeClient role={session.user.role} />;
}
