import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

const before = { name: 'AC', category: 'Split' };

function setup(found: unknown = before) {
  const prisma = {
    product: { findUnique: jest.fn().mockResolvedValue(found), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const service = new ProductsService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

describe('ProductsService.editIdentity (gudang)', () => {
  it('hanya nama & kategori yang ditulis, nama lama masuk audit', async () => {
    const { service, prisma } = setup();
    await service.editIdentity('p1', { name: 'AC Sharp', category: 'Split', sellPrice: 1, active: true, pk: 9 }, 'g1');
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { name: 'AC Sharp', category: 'Split' },
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data.detail).toEqual({
      sebelum: before,
      sesudah: { name: 'AC Sharp', category: 'Split' },
    });
  });

  it('produk tidak ada: ditolak', async () => {
    const { service, prisma } = setup(null);
    await expect(service.editIdentity('x', { name: 'X' }, 'g1')).rejects.toThrow(NotFoundException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});
