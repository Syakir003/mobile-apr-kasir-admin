import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AcUnitCorrectionsService } from './ac-unit-corrections.service';

function setup(unit: any, pending: any = null) {
  const tx: any = {
    $executeRaw: jest.fn(),
    acUnitCorrection: {
      findFirst: jest.fn(async () => pending),
      create: jest.fn(async ({ data }) => ({ id: 'c1', ...data })),
      findUnique: jest.fn(),
      update: jest.fn(async ({ data }) => ({ id: 'c1', ...data })),
    },
    memberAcUnit: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma: any = {
    memberAcUnit: { findUnique: jest.fn(async () => unit) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { svc: new AcUnitCorrectionsService(prisma), tx, prisma };
}

const aktif = { id: 'u1', status: 'aktif', brand: 'LG', model: 'X', pk: new Prisma.Decimal(1), roomLocation: 'Kamar', serialNumber: null, installationDate: null };

describe('AcUnitCorrectionsService.submit', () => {
  it('simpan hanya field yang berbeda', async () => {
    const { svc, tx } = setup(aktif);
    await svc.submit('u1', { brand: 'LG', pk: 1.5, roomLocation: 'Ruang Tamu' }, 't1');
    const data = tx.acUnitCorrection.create.mock.calls[0][0].data;
    expect(data.brand).toBeUndefined();
    expect(Number(data.pk)).toBe(1.5);
    expect(data.roomLocation).toBe('Ruang Tamu');
  });

  it('tolak kalau tidak ada yang berbeda', async () => {
    const { svc } = setup(aktif);
    await expect(svc.submit('u1', { brand: 'LG', pk: 1 }, 't1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tolak unit menunggu_data', async () => {
    const { svc } = setup({ ...aktif, status: 'menunggu_data' });
    await expect(svc.submit('u1', { brand: 'Sharp' }, 't1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tolak kalau sudah ada koreksi pending', async () => {
    const { svc } = setup(aktif, { id: 'old' });
    await expect(svc.submit('u1', { brand: 'Sharp' }, 't1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AcUnitCorrectionsService approve/reject', () => {
  it('approve menimpa hanya field terisi ke unit', async () => {
    const { svc, tx } = setup(aktif);
    tx.acUnitCorrection.findUnique.mockResolvedValue({ id: 'c1', unitId: 'u1', status: 'pending', brand: 'Sharp', pk: null, model: null, roomLocation: null, serialNumber: null, installationDate: null });
    await svc.approve('c1', 'admin');
    expect(tx.memberAcUnit.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { brand: 'Sharp' } });
    expect(tx.acUnitCorrection.update.mock.calls[0][0].data.status).toBe('approved');
  });

  it('approve ulang -> 409', async () => {
    const { svc, tx } = setup(aktif);
    tx.acUnitCorrection.findUnique.mockResolvedValue({ id: 'c1', unitId: 'u1', status: 'approved' });
    await expect(svc.approve('c1', 'admin')).rejects.toBeInstanceOf(ConflictException);
  });

  it('reject wajib alasan', async () => {
    const { svc } = setup(aktif);
    await expect(svc.reject('c1', 'admin', '  ')).rejects.toBeInstanceOf(BadRequestException);
  });
});
