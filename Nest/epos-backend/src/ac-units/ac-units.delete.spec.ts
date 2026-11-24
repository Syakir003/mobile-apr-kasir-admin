import { AcUnitsService } from './ac-units.service';

// Hapus unit AC (admin): hanya unit tanpa job aktif dan tanpa riwayat servis SELESAI; yang lain dilewati beserta alasannya.

const unit = (id: string, memberId = 'm1', extra: Record<string, unknown> = {}) => ({
  id,
  memberId,
  barcodeValue: `ACUNIT-${id}`,
  brand: null,
  model: null,
  ...extra,
});

function setup(units: Record<string, unknown>[], jobs: { unitId: string | null; status: string }[] = []) {
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    memberAcUnit: {
      findMany: jest.fn(async () => units),
      deleteMany: jest.fn(async () => ({ count: units.length })),
    },
    technicianJob: { findMany: jest.fn(async () => jobs) },
    serviceOrderUnit: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    acUnitCorrection: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    member: { updateMany: jest.fn(async () => ({ count: 1 })) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const svc = new AcUnitsService(prisma, {} as any, {} as any);
  return { svc, tx };
}

describe('AcUnitsService.deleteMany', () => {
  it('unit tanpa job apa pun dihapus: baris turunan dibersihkan, hitungan member dikurangi, audit per unit', async () => {
    const { svc, tx } = setup([unit('u1', 'm1', { brand: 'Daikin', model: 'FT' }), unit('u2', 'm1')]);
    const res = await svc.deleteMany({ unitIds: ['u1', 'u2'] }, 'a1');

    expect(res).toMatchObject({ ok: true, deleted: 2, deletedIds: ['u1', 'u2'], skipped: [] });
    expect(tx.serviceOrderUnit.deleteMany).toHaveBeenCalledWith({ where: { unitId: { in: ['u1', 'u2'] } } });
    expect(tx.acUnitCorrection.deleteMany).toHaveBeenCalledWith({ where: { unitId: { in: ['u1', 'u2'] } } });
    expect(tx.memberAcUnit.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['u1', 'u2'] } } });
    // Dua unit milik member yang sama: dikurangi 2 sekaligus.
    expect(tx.member.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', totalAcUnits: { gte: 2 } },
      data: { totalAcUnits: { decrement: 2 } },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'ac_unit.delete',
      target: 'u1',
      detail: { reason: 'hapus_manual', barcodeValue: 'ACUNIT-u1', memberId: 'm1', brand: 'Daikin', model: 'FT' },
    });
  });

  it('unit yang jobnya hanya dibatalkan boleh dihapus', async () => {
    const { svc, tx } = setup([unit('u1')], [{ unitId: 'u1', status: 'dibatalkan' }]);
    const res = await svc.deleteMany({ unitIds: ['u1'] }, 'a1');
    expect(res.deleted).toBe(1);
    expect(tx.memberAcUnit.deleteMany).toHaveBeenCalled();
  });

  it('unit dengan job aktif dilewati beserta alasannya, tidak ada yang terhapus', async () => {
    const { svc, tx } = setup([unit('u1')], [{ unitId: 'u1', status: 'sedang_dikerjakan' }]);
    const res = await svc.deleteMany({ unitIds: ['u1'] }, 'a1');
    expect(res.deleted).toBe(0);
    expect(res.skipped).toEqual([
      expect.objectContaining({ id: 'u1', barcodeValue: 'ACUNIT-u1', reason: expect.stringMatching(/Masih punya job servis/) }),
    ]);
    expect(tx.memberAcUnit.deleteMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('unit dengan riwayat servis selesai tidak dihapus (riwayat & garansi tetap utuh)', async () => {
    const { svc, tx } = setup(
      [unit('u1')],
      [
        { unitId: 'u1', status: 'selesai' },
        { unitId: 'u1', status: 'selesai' },
      ],
    );
    const res = await svc.deleteMany({ unitIds: ['u1'] }, 'a1');
    expect(res.skipped[0].reason).toMatch(/riwayat servis \(2 job selesai\)/);
    expect(tx.memberAcUnit.deleteMany).not.toHaveBeenCalled();
  });

  it('campuran: yang boleh dihapus tetap terhapus, yang tidak dilewati, yang tidak ada dilaporkan', async () => {
    const { svc, tx } = setup(
      [unit('u1'), unit('u2', 'm2'), unit('u3')],
      [
        { unitId: 'u2', status: 'selesai' },
        { unitId: 'u3', status: 'menunggu_review' },
      ],
    );
    const res = await svc.deleteMany({ unitIds: ['u1', 'u2', 'u3', 'u9'] }, 'a1');
    expect(res.deletedIds).toEqual(['u1']);
    expect(res.skipped.map((s) => s.id)).toEqual(['u2', 'u3', 'u9']);
    expect(res.skipped[2].reason).toMatch(/tidak ditemukan/);
    expect(tx.memberAcUnit.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['u1'] } } });
  });

  it('id ganda dibuang; hitungan dikurangi per member', async () => {
    const { svc, tx } = setup([unit('u1', 'm1'), unit('u2', 'm2')]);
    const res = await svc.deleteMany({ unitIds: ['u1', 'u1', 'u2'] }, 'a1');
    expect(res.deleted).toBe(2);
    expect(tx.member.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', totalAcUnits: { gte: 1 } },
      data: { totalAcUnits: { decrement: 1 } },
    });
    expect(tx.member.updateMany).toHaveBeenCalledWith({
      where: { id: 'm2', totalAcUnits: { gte: 1 } },
      data: { totalAcUnits: { decrement: 1 } },
    });
  });
});
