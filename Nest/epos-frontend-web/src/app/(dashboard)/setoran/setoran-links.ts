// Pembuat tautan verifikasi setoran. SENGAJA bukan file 'use client' supaya bisa dipanggil dari Server Component
// (teknisi/jobs/[id]/page.tsx) maupun komponen klien.

/** Tab Setoran Teknisi di Antrian Servis; technicianId = filter teknisi yang dipilih (kosong = semua). */
export const setoranQueueHref = (technicianId?: string) =>
  `/teknisi/queue?tab=setoran${technicianId ? `&technicianId=${encodeURIComponent(technicianId)}` : ''}`;

/** Halaman job mode setoran (panel Aksi berisi pencocokan); technicianId dibawa pulang oleh tombol Kembali. */
export const setoranJobHref = (jobId: string, technicianId?: string) =>
  `/teknisi/jobs/${jobId}?setoran=1${technicianId ? `&technicianId=${encodeURIComponent(technicianId)}` : ''}`;
