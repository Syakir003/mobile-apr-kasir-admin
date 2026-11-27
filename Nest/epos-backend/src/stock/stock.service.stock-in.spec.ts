import { StockService } from './stock.service';

type Overrides = {
  product?: Record<string, unknown>;
  pairedCount?: number;
  sparepart?: Record<string, unknown>;
  existingCost?: Record<string, unknown> | null;
};

function setup(o: Overrides = {}) {
  let seq = 0;
  const tx = {
    product: {
      findUnique: jest.fn(({ where }) =>
        Promise.resolve({ id: where.id, name: `Produk ${where.id}`, sku: null, sellPrice: 3500000, pairedProductId: 'out', ...o.product }),
      ),
      count: jest.fn().mockResolvedValue(o.pairedCount ?? 0),
    },
    sparepart: { findUnique: jest.fn().mockResolvedValue({ id: 'sp', name: 'Pipa', batchTracked: false, ...o.sparepart }) },
    itemCost: {
      create: jest.fn(() => Promise.resolve({ id: `batch-${++seq}` })),
      findFirst: jest.fn().mockResolvedValue(o.existingCost ?? null),
      update: jest.fn(),
    },
    stockUnit: { create: jest.fn(({ data }) => Promise.resolve({ id: 'u', ...data })) },
    stockMovement: { create: jest.fn().mockResolvedValue({ id: 'm' }) },
    auditLog: { create: jest.fn() },
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ stock: '0' }]),
    $executeRawUnsafe: jest.fn(),
  };
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
  const locking = { lockAndAdd: jest.fn().mockResolvedValue({ name: 'Freon', previousStock: 2 }) };
  const counters = { nextSeq: jest.fn().mockResolvedValue(1) };
  const service = new StockService(prisma as any, locking as any, counters as any);
  const createdPrices = () => tx.itemCost.create.mock.calls.map((c: any[]) => c[0].data.buyPrice);
  return { service, tx, createdPrices };
}

describe('StockService.stockIn tanpa harga modal', () => {
  it('AC tunggal: batch NULL, tanpa konfirmasi', async () => {
    const { service, createdPrices } = setup({ product: { sellPrice: 0 } });
    const result = await service.stockIn({ kind: 'product', refId: 'p1', qty: 2 }, 'u1');
    expect(createdPrices()).toEqual([null]);
    expect(result).toMatchObject({ status: 'ok', costPending: true });
  });

  it('paket: Indoor NULL, Outdoor 0', async () => {
    const { service, createdPrices } = setup();
    const result = await service.stockIn(
      { kind: 'product', refId: 'in', qty: 1, pairMode: 'lengkap', outdoorRefId: 'out' }, 'u1');
    expect(createdPrices()).toEqual([null, 0]);
    expect(result).toMatchObject({ status: 'ok', costPending: true });
  });

  it('paket yang datang cuma Outdoor: tidak ada modal tertunda', async () => {
    const { service, createdPrices } = setup();
    const result = await service.stockIn(
      { kind: 'product', refId: 'in', qty: 0, outdoorQty: 2, pairMode: 'lengkap', outdoorRefId: 'out' }, 'u1');
    expect(createdPrices()).toEqual([0]);
    expect(result).toMatchObject({ status: 'ok', costPending: false });
  });

  it('Outdoor milik paket diterima sendiri: 0, bukan belum diisi', async () => {
    const { service, createdPrices } = setup({ pairedCount: 1 });
    const result = await service.stockIn({ kind: 'product', refId: 'out', qty: 1 }, 'u1');
    expect(createdPrices()).toEqual([0]);
    expect(result).toMatchObject({ status: 'ok', costPending: false });
  });

  it('sparepart gulungan: tiap gulungan NULL', async () => {
    const { service, createdPrices } = setup({ sparepart: { batchTracked: true } });
    const result = await service.stockIn(
      { kind: 'sparepart', refId: 'sp', rolls: [{ length: 15 }, { length: 12 }] }, 'u1');
    expect(createdPrices()).toEqual([null, null]);
    expect(result).toMatchObject({ status: 'ok', costPending: true });
  });

  it('sparepart biasa yang sudah punya harga: harga lama tidak disentuh', async () => {
    const { service, tx } = setup({ existingCost: { id: 'c1', buyPrice: 1000 } });
    const result = await service.stockIn({ kind: 'sparepart', refId: 'sp', qty: 3 }, 'u1');
    expect(tx.itemCost.update).not.toHaveBeenCalled();
    expect(tx.itemCost.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ok', costPending: false });
  });

  it('sparepart biasa yang harganya masih kosong: tetap tertunda', async () => {
    const { service } = setup({ existingCost: { id: 'c1', buyPrice: null } });
    const result = await service.stockIn({ kind: 'sparepart', refId: 'sp', qty: 3 }, 'u1');
    expect(result).toMatchObject({ status: 'ok', costPending: true });
  });

  it('sparepart biasa belum punya baris: dibuat NULL', async () => {
    const { service, createdPrices } = setup();
    const result = await service.stockIn({ kind: 'sparepart', refId: 'sp', qty: 3 }, 'u1');
    expect(createdPrices()).toEqual([null]);
    expect(result).toMatchObject({ status: 'ok', costPending: true });
  });

  it('dengan harga: tersimpan apa adanya, costPending false', async () => {
    const { service, createdPrices } = setup();
    const result = await service.stockIn({ kind: 'product', refId: 'p1', qty: 1, buyPrice: 100 }, 'u1');
    expect(createdPrices()).toEqual([100]);
    expect(result).toMatchObject({ status: 'ok', costPending: false });
  });
});
