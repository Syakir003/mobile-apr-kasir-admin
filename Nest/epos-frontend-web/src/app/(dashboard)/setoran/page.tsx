import { redirect } from 'next/navigation';

import { SetoranClient } from './setoran-client';

// Halaman admin "Laporan Uang di Teknisi". Hanya admin (lihat proxy.ts; API-nya juga admin-only di backend).
// Verifikasi setoran sendiri dikerjakan di Antrian Servis > tab Setoran Teknisi (dan halaman job), jadi tautan lama
// (?tab=tunai|mutasi atau ?technicianId=, mis. dari notifikasi lama) dialihkan ke sana.
export default async function SetoranPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; technicianId?: string }>;
}) {
  const { tab, technicianId } = await searchParams;
  if (tab !== 'laporan' && (tab === 'tunai' || tab === 'mutasi' || technicianId)) {
    redirect(`/teknisi/queue?tab=setoran${technicianId ? `&technicianId=${encodeURIComponent(technicianId)}` : ''}`);
  }
  return <SetoranClient />;
}
