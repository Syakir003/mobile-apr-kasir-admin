import { requireSession } from '@/lib/server-api';
import { ProfilClient } from './profil-client';

// Server Component tipis, pola sama kayak teknisi/dashboard/page.tsx —
// session (httpOnly cookie) dibaca di server, diturunkan sebagai prop.
// Semua role (admin/kasir/teknisi) punya halaman ini, padanan `profile`
// yang selalu ada di destinationsForRole() app mobile buat role manapun.
export default async function ProfilPage() {
  const session = await requireSession();
  return <ProfilClient user={session.user} />;
}
