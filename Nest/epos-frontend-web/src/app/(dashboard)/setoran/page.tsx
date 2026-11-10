import { SetoranClient } from './setoran-client';

// Halaman admin "Setoran Teknisi". Hanya admin (lihat proxy.ts; API-nya juga admin-only di backend).
// ?tab=tunai|mutasi|laporan dan ?technicianId=<id> = tujuan dari notifikasi bel (uang tertahan / pembayaran baru).
export default async function SetoranPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; technicianId?: string }>;
}) {
  const { tab, technicianId } = await searchParams;
  const initialTab = tab === 'mutasi' || tab === 'laporan' ? tab : 'tunai';
  return <SetoranClient initialTab={initialTab} initialTechnicianId={technicianId ?? ''} />;
}
