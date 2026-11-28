import { ForbiddenException } from '@nestjs/common';
import { SparepartsService } from './spareparts.service';

function setup(count: number) {
  const prisma = {
    sparepart: {
      updateMany: jest.fn().mockResolvedValue({ count }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    auditLog: { create: jest.fn() },
  };
  const service = new SparepartsService(prisma as never, {} as never);
  return { service, prisma };
}

const sneaky = { name: ' Freon R32 ', sku: 'F-1', category: 'Gas', sellPrice: 1, active: true, unit: 'kg', packSize: 99 };

describe('SparepartsService.fixPending (gudang)', () => {
  it('hanya nama, SKU, kategori yang ditulis; harga, status, satuan diabaikan', async () => {
    const { service, prisma } = setup(1);
    await service.fixPending('s1', sneaky, 'g1');
    expect(prisma.sparepart.updateMany.mock.calls[0][0].data).toEqual({ name: 'Freon R32', sku: 'F-1', category: 'Gas' });
  });

  it('syarat menunggu harga menyatu dengan penulisan (aman dari balapan dengan admin)', async () => {
    const { service, prisma } = setup(1);
    await service.fixPending('s1', { name: 'X' }, 'g1');
    expect(prisma.sparepart.updateMany.mock.calls[0][0].where).toEqual({
      id: 's1',
      active: false,
      OR: [
        { sellPrice: { lte: 0 } },
        {
          trackingMode: { in: ['konversi', 'gabungan'] },
          OR: [{ sellPricePack: null }, { sellPricePack: { lte: 0 } }],
        },
      ],
    });
  });

  it('sudah diberi harga atau aktif: ditolak, tidak dicatat di audit', async () => {
    const { service, prisma } = setup(0);
    await expect(service.fixPending('s1', { name: 'X' }, 'g1')).rejects.toThrow(ForbiddenException);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('nama dikosongkan: ditolak', async () => {
    const { service, prisma } = setup(1);
    await expect(service.fixPending('s1', { name: '  ' }, 'g1')).rejects.toThrow('Nama');
    expect(prisma.sparepart.updateMany).not.toHaveBeenCalled();
  });
});
