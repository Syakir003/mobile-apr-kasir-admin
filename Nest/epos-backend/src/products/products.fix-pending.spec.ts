import { ForbiddenException } from '@nestjs/common';
import { ProductsService } from './products.service';

function setup(count: number) {
  const prisma = {
    product: { updateMany: jest.fn().mockResolvedValue({ count }) },
    auditLog: { create: jest.fn() },
  };
  const service = new ProductsService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

describe('ProductsService.fixPending (gudang)', () => {
  it('hanya nama & kategori; syaratnya masih menunggu harga dan bukan outdoor', async () => {
    const { service, prisma } = setup(1);
    await service.fixPending('p1', { name: 'AC Sharp', category: 'Split', sellPrice: 1, active: true, pk: 9 }, 'g1');
    expect(prisma.product.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'p1', active: false, sellPrice: { lte: 0 }, OR: [{ acRole: null }, { acRole: { not: 'outdoor' } }] },
      data: { name: 'AC Sharp', category: 'Split' },
    });
  });

  it('sudah diberi harga atau aktif: ditolak', async () => {
    const { service } = setup(0);
    await expect(service.fixPending('p1', { name: 'X' }, 'g1')).rejects.toThrow(ForbiddenException);
  });
});
