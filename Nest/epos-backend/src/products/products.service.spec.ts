import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('ProductsService — pairedProductId (Point 2)', () => {
  function makeService(overrides: {
    findUniqueImpl?: (args: any) => any;
    findFirstImpl?: (args: any) => any;
  } = {}) {
    const product = {
      findUnique: jest.fn(overrides.findUniqueImpl ?? (() => ({ id: 'outdoor-1' }))),
      findFirst: jest.fn(overrides.findFirstImpl ?? (() => null)),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      create: jest.fn((args: any) => ({ id: 'new-id', ...args.data })),
    };
    const prisma: any = {
      product,
      auditLog: { create: jest.fn() },
      $transaction: (fn: any) => fn(prisma),
    };
    const counters: any = { nextSeq: jest.fn(async () => 1) };
    return { service: new ProductsService(prisma, counters), prisma };
  }

  it('update() nolak pairedProductId yang gak ada produknya', async () => {
    const { service } = makeService({ findUniqueImpl: (args: any) => (args.where?.id === 'x' ? { id: 'x' } : null) });
    await expect(
      service.update('x', { pairedProductId: 'ghost-id' } as any, 'actor-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update() terima pairedProductId yang valid', async () => {
    const { service, prisma } = makeService({
      findUniqueImpl: (args: any) =>
        args.where?.id === 'indoor-1' ? { id: 'indoor-1' } : { id: 'outdoor-1' },
    });
    const result = await service.update('indoor-1', { pairedProductId: 'outdoor-1' } as any, 'actor-1');
    expect(result).toMatchObject({ pairedProductId: 'outdoor-1' });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pairedProductId: 'outdoor-1' }) }),
    );
  });

  // Paket AC Split (2026-09-30) — peran unit dijaga konsisten sama pairing.
  it('create() dengan pairedProductId maksa acRole indoor & tandain pasangannya outdoor', async () => {
    const { service, prisma } = makeService({
      findUniqueImpl: (args: any) => (args.where?.id === 'outdoor-1' ? { id: 'outdoor-1', pairedProductId: null } : null),
    });
    await service.create({ name: 'Indoor', sellPrice: 1, pairedProductId: 'outdoor-1', acRole: 'outdoor' } as any);
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acRole: 'indoor' }) }),
    );
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'outdoor-1' }, data: { acRole: 'outdoor' } });
  });

  it('create() tanpa pasangan pakai acRole yang dikirim (Indoor saja / Outdoor saja)', async () => {
    const { service, prisma } = makeService();
    await service.create({ name: 'Outdoor saja', sellPrice: 1, acRole: 'outdoor' } as any);
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acRole: 'outdoor' }) }),
    );
  });

  it('update() nolak ganti acRole produk yang jadi Outdoor sebuah paket', async () => {
    const { service } = makeService({
      findUniqueImpl: () => ({ id: 'outdoor-1', pairedProductId: null }),
      findFirstImpl: (args: any) => (args.where?.pairedProductId === 'outdoor-1' ? { id: 'indoor-1' } : null),
    });
    await expect(service.update('outdoor-1', { acRole: 'indoor' } as any, 'actor-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
