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
  // key: bila admin sedang di /setoran lalu menekan notifikasi (parameter URL berubah), halaman dipasang ulang dengan nilai baru.
  return <SetoranClient key={`${initialTab}:${technicianId ?? ''}`} initialTab={initialTab} initialTechnicianId={technicianId ?? ''} />;
}
