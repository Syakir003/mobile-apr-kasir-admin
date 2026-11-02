import { Prisma } from '@prisma/client';
import { releaseUnitMaintenanceTx } from './unit-maintenance.util';

function makeTx(openOtherJobs: number, updated = 1) {
  const count = jest.fn().mockResolvedValue(openOtherJobs);
  const updateMany = jest.fn().mockResolvedValue({ count: updated });
  const tx = {
    technicianJob: { count },
    memberAcUnit: { updateMany },
  } as unknown as Prisma.TransactionClient;
  return { tx, count, updateMany };
}

describe('releaseUnitMaintenanceTx', () => {
  it('mengembalikan unit dalam_maintenance ke aktif bila tidak ada job lain yang berjalan', async () => {
    const { tx, count, updateMany } = makeTx(0);

    await expect(releaseUnitMaintenanceTx(tx, 'unit-1', 'job-1')).resolves.toBe(
      true,
    );

    expect(count).toHaveBeenCalledWith({
      where: {
        unitId: 'unit-1',
        id: { not: 'job-1' },
        status: { notIn: ['selesai', 'dibatalkan'] },
      },
    });
    // hanya status 'dalam_maintenance' yang disentuh
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'unit-1', status: 'dalam_maintenance' },
      data: { status: 'aktif' },
    });
  });

  it('tidak mengubah apa pun kalau masih ada job lain yang berjalan di unit itu', async () => {
    const { tx, updateMany } = makeTx(1);

    await expect(releaseUnitMaintenanceTx(tx, 'unit-1', 'job-1')).resolves.toBe(
      false,
    );

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('false bila status unit bukan dalam_maintenance (mis. rusak/nonaktif diatur admin)', async () => {
    const { tx } = makeTx(0, 0);

    await expect(releaseUnitMaintenanceTx(tx, 'unit-1', 'job-1')).resolves.toBe(
      false,
    );
  });
});
