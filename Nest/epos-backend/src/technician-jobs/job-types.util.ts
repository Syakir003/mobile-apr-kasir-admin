/**
 * Jenis job yang MEMASANG unit AC (unit jadi 'aktif' + tanggal pasang terisi saat disetujui, tidak masuk
 * 'dalam_maintenance' selama dikerjakan):
 *  - 'pemasangan'      = dari kasir (POS): harga mengikuti invoice POS, tidak dihargai/ditagih teknisi.
 *  - 'pemasangan_jasa' = jasa pasang dari Terima Servis (pelanggan sudah punya AC-nya): dihargai & ditagih seperti servis
 *                        biasa (baris jasa, invoice servis, boleh bayar di lokasi). Semua aturan khusus POS
 *                        (`type === 'pemasangan'`) sengaja TIDAK berlaku untuk jenis ini.
 */
export const INSTALL_JOB_TYPES = ['pemasangan', 'pemasangan_jasa'] as const;

export function isInstallJobType(jobType: string): boolean {
  return (INSTALL_JOB_TYPES as readonly string[]).includes(jobType);
}
