import { requireSession } from '@/lib/server-api';
import { DataLampauClient } from './data-lampau-client';

// ?tab=koreksi dipakai tautan notifikasi "Koreksi Data AC Menunggu Persetujuan" (lihat notification-bell).
export default async function DataLampauPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireSession();
  const { tab } = await searchParams;
  const initialTab = tab === 'koreksi' || tab === 'label' ? tab : 'input';
  // key: klik notifikasi saat halaman ini sudah terbuka tetap berpindah ke tab yang dituju.
  return <DataLampauClient key={initialTab} initialTab={initialTab} />;
}
