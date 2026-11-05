import { requireSession } from '@/lib/server-api';
import { ServiceIntakeClient } from './intake-client';

// Server Component tipis: cuma baca role dari session (httpOnly cookie) buat
// nentuin apakah dropdown "Teknisi" ditampilkan (GET /users admin-only di
// backend) — sama pola persis kayak teknisi/queue/page.tsx.
// ?memberId=<id>&jatuhTempo=1 = isian otomatis dari notifikasi bel: pelanggan terpilih, unit yang jatuh tempo tercentang,
// jenis Cuci AC. ?memberId=<id>&unitIds=a,b = sama, tetapi yang tercentang = unit pilihan admin di halaman jadwal pelanggan.
// Jadwal sengaja dikosongkan: admin yang menentukan.
export default async function ServiceIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ memberId?: string; jatuhTempo?: string; unitIds?: string }>;
}) {
  const session = await requireSession();
  const { memberId, jatuhTempo, unitIds } = await searchParams;
  return (
    <ServiceIntakeClient
      role={session.user.role}
      prefill={
        memberId
          ? { memberId, dueOnly: jatuhTempo === '1', unitIds: unitIds ? unitIds.split(',').filter(Boolean) : undefined }
          : undefined
      }
    />
  );
}
