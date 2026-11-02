import { Prisma, TechnicianJobStatus } from '@prisma/client';

/**
 * start() menaruh unit AC di 'dalam_maintenance' selama job non-pemasangan dikerjakan. Fungsi ini
 * mengembalikannya ke 'aktif' begitu job selesai/dibatalkan. Tanpa ini cron pengingat servis (yang
 * hanya memproses unit 'aktif') melewati unit itu selamanya.
 *
 * - Tidak mengubah apa pun kalau masih ada job LAIN yang berjalan di unit yang sama.
 * - Hanya menyentuh status 'dalam_maintenance' — status yang diatur manual admin ('rusak',
 *   'nonaktif', dst) tidak ditimpa.
 *
 * Dipanggil di dalam transaksi job (status job ini sudah diubah ke selesai/dibatalkan di `tx`,
 * `excludeJobId` tetap dikecualikan supaya tidak bergantung pada urutan update).
 * Mengembalikan true bila status unit diubah.
 */
export async function releaseUnitMaintenanceTx(
  tx: Prisma.TransactionClient,
  unitId: string,
  excludeJobId: string,
): Promise<boolean> {
  const otherOpen = await tx.technicianJob.count({
    where: {
      unitId,
      id: { not: excludeJobId },
      status: {
        notIn: [TechnicianJobStatus.selesai, TechnicianJobStatus.dibatalkan],
      },
    },
  });
  if (otherOpen > 0) return false;

  const res = await tx.memberAcUnit.updateMany({
    where: { id: unitId, status: 'dalam_maintenance' },
    data: { status: 'aktif' },
  });
  return res.count > 0;
}
