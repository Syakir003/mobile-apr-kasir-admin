import { Prisma, TechnicianJobStatus } from '@prisma/client';

/**
 * Apakah unit AC ini SUDAH terlabel QR — dipakai halaman Terima Servis (lewati halaman cetak label) dan
 * kartu QR di halaman job ("Unit AC sudah terlabel").
 *
 * Dianggap terlabel kalau:
 * - tercatat sudah dicetak/ditempel (`labelPrintedAt` / `labelAttachedAt`, mis. dari Input Data Lampau), atau
 * - sudah pernah punya job lain yang tidak dibatalkan: halaman cetak label sudah muncul saat job pertamanya dibuat.
 *
 * `before`: hanya hitung job yang dibuat SEBELUM waktu ini (untuk menilai satu job tertentu, jadi job itu sendiri
 * tidak ikut dihitung). Tanpa `before`: semua job yang ada (dipakai sebelum job baru dibuat).
 */
export async function isUnitLabeled(
  db: Pick<Prisma.TransactionClient, 'technicianJob'>,
  unit: { id: string; labelPrintedAt: Date | null; labelAttachedAt: Date | null },
  before?: Date,
): Promise<boolean> {
  if (unit.labelPrintedAt || unit.labelAttachedAt) return true;
  const earlierJobs = await db.technicianJob.count({
    where: {
      unitId: unit.id,
      status: { not: TechnicianJobStatus.dibatalkan },
      ...(before ? { createdAt: { lt: before } } : {}),
    },
  });
  return earlierJobs > 0;
}
