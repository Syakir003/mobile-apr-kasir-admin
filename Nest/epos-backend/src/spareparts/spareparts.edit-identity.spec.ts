import { NotFoundException } from '@nestjs/common';
import { SparepartsService } from './spareparts.service';

const before = { name: 'Freon', sku: null, category: null };

function setup(found: unknown = before) {
  const prisma = {
    sparepart: {
      findUnique: jest.fn().mockResolvedValue(found),
      update: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    auditLog: { create: jest.fn() },
  };
  const service = new SparepartsService(prisma as never, {} as never);
  return { service, prisma };
}

const sneaky = { name: ' Freon R32 ', sku: 'F-1', category: 'Gas', sellPrice: 1, active: true, unit: 'kg', packSize: 99 };

describe('SparepartsService.editIdentity (gudang)', () => {
  it('hanya nama, SKU, kategori yang ditulis; harga, status, satuan diabaikan', async () => {
    const { service, prisma } = setup();
    await service.editIdentity('s1', sneaky, 'g1');
    expect(prisma.sparepart.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { name: 'Freon R32', sku: 'F-1', category: 'Gas' },
    });
  });

  it('boleh untuk barang yang sudah berharga; nama lama ikut dicatat di audit', async () => {
    const { service, prisma } = setup();
    await service.editIdentity('s1', { name: 'Freon R32' }, 'g1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUid: 'g1',
        action: 'sparepart.edit_identity',
        target: 's1',
        detail: { sebelum: before, sesudah: { name: 'Freon R32' } },
      },
    });
  });

  it('barang tidak ada: ditolak, tidak ada yang ditulis', async () => {
    const { service, prisma } = setup(null);
    await expect(service.editIdentity('x', { name: 'X' }, 'g1')).rejects.toThrow(NotFoundException);
    expect(prisma.sparepart.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('nama dikosongkan: ditolak', async () => {
    const { service, prisma } = setup();
    await expect(service.editIdentity('s1', { name: '  ' }, 'g1')).rejects.toThrow('Nama');
    expect(prisma.sparepart.update).not.toHaveBeenCalled();
  });
});
