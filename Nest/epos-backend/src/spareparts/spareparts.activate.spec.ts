import { BadRequestException } from '@nestjs/common';
import { SparepartsService } from './spareparts.service';
import { resolveSparepartMode } from './sparepart-mode.util';

// Barang "menunggu harga" tidak boleh diaktifkan (dijual) sebelum ada harganya.

function setup(existing: Record<string, unknown>) {
  const row = {
    id: 's1', name: 'Freon', unit: 'kg', sku: null, active: false, trackingMode: 'biasa',
    batchTracked: false, packUnit: null, packSize: null, sellPricePack: null, sellPrice: 0, stock: 0,
    ...existing,
  };
  const tx = { sparepart: { update: jest.fn().mockResolvedValue(row) } };
  const prisma = {
    sparepart: { findUnique: jest.fn().mockResolvedValue(row), findFirst: jest.fn() },
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    auditLog: { create: jest.fn() },
  };
  const service = new SparepartsService(prisma as any, { save: jest.fn() } as any);
  return { service, tx };
}

describe('mengaktifkan sparepart yang menunggu harga', () => {
  it('ditolak tanpa harga jual', async () => {
    const { service, tx } = setup({});
    await expect(service.update('s1', { active: true }, 'a')).rejects.toThrow(BadRequestException);
    expect(tx.sparepart.update).not.toHaveBeenCalled();
  });

  it('boleh sekalian mengisi harga', async () => {
    const { service, tx } = setup({});
    await service.update('s1', { active: true, sellPrice: 90000 }, 'a');
    expect(tx.sparepart.update).toHaveBeenCalled();
  });

  it('menonaktifkan tetap bebas', async () => {
    const { service, tx } = setup({ active: true });
    await service.update('s1', { active: false }, 'a');
    expect(tx.sparepart.update).toHaveBeenCalled();
  });

  it('mode kemasan boleh tanpa harga utuh hanya saat menunggu harga', () => {
    const input = { trackingMode: 'gabungan', packUnit: 'tabung', packSize: 10 };
    expect(() => resolveSparepartMode(input)).toThrow('Harga jual utuh');
    expect(resolveSparepartMode(input, undefined, { allowNoPrice: true }).sellPricePack).toBeNull();
  });
});
