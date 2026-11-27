import type { Prisma } from '@prisma/client';

export interface DeletableUnit {
  id: string;
  memberId: string;
  barcodeValue: string;
  brand?: string | null;
  model?: string | null;
}

/** Alasan penghapusan yang dicatat di audit. */
export type UnitDeleteReason = 'hapus_manual' | 'job_dibatalkan';

/**
 * Hapus unit AC beserta turunannya, di dalam transaksi pemanggil:
 *  - baris unit di order servis (service_order_units, FK RESTRICT) dan usulan koreksi data (ac_unit_corrections, FK RESTRICT);
 *  - hitungan unit member (members.total_ac_units) dikurangi, tidak pernah di bawah 0;
 *  - satu baris audit `ac_unit.delete` per unit (kode QR, merk, member, alasan) supaya penghapusan bisa ditelusuri.
 * Job yang pernah menunjuk unit ini TETAP ada: technician_jobs.unit_id berubah jadi NULL lewat FK ON DELETE SET NULL
 * (hanya job dibatalkan yang boleh sampai sini; aturan siapa yang boleh dihapus ada di pemanggil). Pemanggil juga yang
 * memastikan unit tidak punya job aktif/riwayat selesai.
 */
export async function deleteUnitsTx(
  tx: Prisma.TransactionClient,
  units: DeletableUnit[],
  actorId: string,
  reason: UnitDeleteReason,
  extraDetail: Record<string, unknown> = {},
): Promise<void> {
  if (units.length === 0) return;
  const ids = units.map((u) => u.id);
  await tx.serviceOrderUnit.deleteMany({ where: { unitId: { in: ids } } });
  await tx.acUnitCorrection.deleteMany({ where: { unitId: { in: ids } } });
  await tx.memberAcUnit.deleteMany({ where: { id: { in: ids } } });

  // Hitungan unit member: kurangi sebanyak yang terhapus; data yang sudah tidak sinkron (lebih kecil) dipaksa ke 0.
  const perMember = new Map<string, number>();
  for (const u of units) perMember.set(u.memberId, (perMember.get(u.memberId) ?? 0) + 1);
  for (const [memberId, n] of perMember) {
    await tx.member.updateMany({ where: { id: memberId, totalAcUnits: { gte: n } }, data: { totalAcUnits: { decrement: n } } });
    await tx.member.updateMany({ where: { id: memberId, totalAcUnits: { lt: n } }, data: { totalAcUnits: 0 } });
  }

  for (const u of units) {
    await tx.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'ac_unit.delete',
        target: u.id,
        detail: {
          reason,
          barcodeValue: u.barcodeValue,
          memberId: u.memberId,
          brand: u.brand ?? null,
          model: u.model ?? null,
          ...extraDetail,
        },
      },
    });
  }
}
