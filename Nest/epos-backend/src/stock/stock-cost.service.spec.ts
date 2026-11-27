import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { StockController } from './stock.controller';
import { StockCostService } from './stock-cost.service';

type Row = Record<string, any>;

const T0 = new Date('2026-11-20T03:00:00Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** Pencocok `where` Prisma, sebatas yang dipakai StockCostService. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'NOT') return !matches(row, cond as Row);
    const value = row[key] ?? null;
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return value === cond;
    const c = cond as Row;
    if ('in' in c) return c.in.includes(value);
    if ('not' in c) return value !== c.not;
    if ('gte' in c) return value >= c.gte;
    return matches(value ?? {}, c);
  });
}

function fakeDb(seed: Record<string, Row[]> = {}) {
  const data: Record<string, Row[]> = {
    itemCost: [], stockMovement: [], invoice: [], invoiceItem: [], product: [], sparepart: [], auditLog: [],
    ...seed,
  };
  const calls: string[] = [];
  const hydrate = (name: string, row: Row): Row => {
    if (name === 'invoiceItem') return { ...row, invoice: data.invoice.find((i) => i.id === row.invoiceId) };
    return { ...row };
  };
  const model = (name: string) => {
    const select = (where?: Row) => data[name].map((r) => hydrate(name, r)).filter((r) => matches(r, where));
    const patch = (where: Row, change: Row) => {
      const ids = select(where).map((r) => r.id);
      data[name].filter((r) => ids.includes(r.id)).forEach((r) => Object.assign(r, change));
      return { count: ids.length };
    };
    return {
      findUnique: async ({ where }: Row) => select(where)[0] ?? null,
      findFirst: async ({ where }: Row) => { calls.push(`${name}.findFirst`); return select(where)[0] ?? null; },
      findMany: async ({ where }: Row = {}) => { calls.push(`${name}.findMany`); return select(where); },
      count: async ({ where }: Row) => select(where).length,
      update: async ({ where, data: change }: Row) => { patch(where, change); return select(where)[0]; },
      updateMany: async ({ where, data: change }: Row) => patch(where, change),
      create: async ({ data: row }: Row) => { data[name].push({ id: `${name}-${data[name].length}`, ...row }); return row; },
    };
  };
  const tx: any = {
    $queryRawUnsafe: async (sql: string) => { calls.push(sql); return []; },
  };
  for (const name of Object.keys(data)) tx[name] = model(name);
  tx.$transaction = async (fn: (t: unknown) => unknown) => fn(tx);
  return { service: new StockCostService(tx), data, calls };
}

const ac = { id: 'ac', name: 'AC Sharp', sellPrice: 4000000, pairedProductId: null };
const cost = (id: string, buyPrice: number | null, extra: Row = {}): Row => ({
  id, kind: 'product', refId: 'ac', buyPrice, supplierName: null, createdAt: T0, updatedAt: T0, ...extra,
});
const sold = (transactionId: string, itemCostId: string | null, extra: Row = {}): Row => ({
  id: `mv-${transactionId}-${itemCostId}`, transactionId, itemCostId, itemKind: 'product', refId: 'ac',
  reason: 'penjualan', qtyChange: -1, ...extra,
});
const invoice = (id: string, transactionId: string, extra: Row = {}): Row => ({
  id, transactionId, number: id.toUpperCase(), createdAt: later(60), ...extra,
});
const line = (invoiceId: string, buyPriceSnapshot: number | null, extra: Row = {}): Row => ({
  id: `line-${invoiceId}-${extra.refId ?? 'ac'}`, invoiceId, refId: 'ac', kind: 'product',
  saleKind: null, costUnallocated: false, buyPriceSnapshot, ...extra,
});

const snapshots = (data: Record<string, Row[]>) => data.invoiceItem.map((i) => i.buyPriceSnapshot);

describe('StockCostService.setCost — barang bermutasi per batch', () => {
  const base = () => ({
    product: [ac],
    itemCost: [cost('c1', null)],
    stockMovement: [sold('t1', 'c1')],
    invoice: [invoice('inv1', 't1')],
    invoiceItem: [line('inv1', null)],
  });

  it('mengisi harga memperbarui invoice AC yang mengambil batch itu', async () => {
    const { service, data } = fakeDb(base());
    const result = await service.setCost('c1', { buyPrice: 3000000 }, 'admin');
    expect(result).toEqual({ status: 'ok', updatedInvoiceNumbers: ['INV1'] });
    expect(snapshots(data)).toEqual([3000000]);
    expect(data.itemCost[0].buyPrice).toBe(3000000);
  });

  it('invoice yang mengambil dua batch memakai harga tertinggi', async () => {
    const seed = base();
    seed.itemCost.push(cost('c2', 3200000));
    seed.stockMovement.push(sold('t1', 'c2'));
    const { service, data } = fakeDb(seed);
    await service.setCost('c1', { buyPrice: 3000000 }, 'admin');
    expect(snapshots(data)).toEqual([3200000]);
  });

  it('koreksi ke harga lebih rendah menurunkan snapshot', async () => {
    const seed = base();
    seed.itemCost = [cost('c1', 35000000)];
    seed.invoiceItem = [line('inv1', 35000000)];
    const { service, data } = fakeDb(seed);
    await service.setCost('c1', { buyPrice: 3500000 }, 'admin');
    expect(snapshots(data)).toEqual([3500000]);
  });

  it('invoice yang tidak mengambil batch itu tidak berubah', async () => {
    const seed = base();
    seed.itemCost.push(cost('c2', 2000000));
    seed.stockMovement.push(sold('t2', 'c2'));
    seed.invoice.push(invoice('inv2', 't2'));
    seed.invoiceItem.push(line('inv2', 2000000));
    const { service, data } = fakeDb(seed);
    const result = await service.setCost('c1', { buyPrice: 3000000 }, 'admin');
    expect(snapshots(data)).toEqual([3000000, 2000000]);
    expect(result).toMatchObject({ updatedInvoiceNumbers: ['INV1'] });
  });

  it('jual satuan dari paket (costUnallocated) tidak berubah', async () => {
    const seed = base();
    seed.invoiceItem = [line('inv1', 0, { costUnallocated: true })];
    const { service, data } = fakeDb(seed);
    await service.setCost('c1', { buyPrice: 3000000 }, 'admin');
    expect(snapshots(data)).toEqual([0]);
  });

  const pipa = { id: 'sp', name: 'Pipa', unit: 'm', sellPrice: 100000, batchTracked: true, packSize: 15 };
  const roll = (id: string, buyPrice: number | null, extra: Row = {}) =>
    cost(id, buyPrice, { kind: 'sparepart', refId: 'sp', ...extra });
  const rollSale = (reason = 'penjualan') => sold('t1', 'r1', { itemKind: 'sparepart', refId: 'sp', reason });

  it('jual utuh dikali packSize dan dibulatkan', async () => {
    const { service, data } = fakeDb({
      sparepart: [pipa],
      itemCost: [roll('r1', null)],
      stockMovement: [rollSale()],
      invoice: [invoice('inv1', 't1')],
      invoiceItem: [line('inv1', null, { refId: 'sp', kind: 'sparepart', saleKind: 'utuh' })],
    });
    await service.setCost('r1', { buyPrice: 60000.01 }, 'admin');
    expect(snapshots(data)).toEqual([900000]);
  });

  it('komponen paket instalasi ikut diperbarui', async () => {
    const { service, data } = fakeDb({
      sparepart: [pipa],
      itemCost: [roll('r1', null)],
      stockMovement: [rollSale('pemakaian_instalasi')],
      invoice: [invoice('inv1', 't1')],
      invoiceItem: [line('inv1', null, { refId: 'sp', kind: 'installation_package_item' })],
    });
    await service.setCost('r1', { buyPrice: 60000 }, 'admin');
    expect(snapshots(data)).toEqual([60000]);
  });

  it('gulungan satu penerimaan diisi sekaligus', async () => {
    const { service, data } = fakeDb({ sparepart: [pipa], itemCost: [roll('r1', null), roll('r2', null)] });
    await service.setCost('r1', { buyPrice: 60000, alsoItemCostIds: ['r2'] }, 'admin');
    expect(data.itemCost.map((c) => c.buyPrice)).toEqual([60000, 60000]);
  });
});

describe('StockCostService.setCost — sparepart biasa', () => {
  const freon = { id: 'sp', name: 'Freon', unit: 'kg', sellPrice: 100000, batchTracked: false, packSize: null };
  const flatLine = (invoiceId: string, snapshot: number | null) =>
    line(invoiceId, snapshot, { refId: 'sp', kind: 'sparepart' });

  it('hanya yang kosong atau berharga lama, sejak harga lama dipasang', async () => {
    const { service, data } = fakeDb({
      sparepart: [freon],
      itemCost: [cost('c1', 900000, { kind: 'sparepart', refId: 'sp', updatedAt: later(30) })],
      invoice: [
        invoice('lama', 't0', { createdAt: later(10) }),
        invoice('a', 't1'), invoice('b', 't2'), invoice('c', 't3'),
      ],
      invoiceItem: [flatLine('lama', null), flatLine('a', null), flatLine('b', 900000), flatLine('c', 50000)],
    });
    const result = await service.setCost('c1', { buyPrice: 90000 }, 'admin');
    expect(snapshots(data)).toEqual([null, 90000, 90000, 50000]);
    expect(result).toMatchObject({ updatedInvoiceNumbers: ['A', 'B'] });
  });
});

describe('StockCostService.setCost — aturan', () => {
  const seed = () => ({ product: [ac], itemCost: [cost('c1', null)] });

  it('harga 0 diterima dan dicatat 0, bukan NULL', async () => {
    const { service, data } = fakeDb({
      ...seed(),
      stockMovement: [sold('t1', 'c1')],
      invoice: [invoice('inv1', 't1')],
      invoiceItem: [line('inv1', null)],
    });
    await service.setCost('c1', { buyPrice: 0 }, 'admin');
    expect(data.itemCost[0].buyPrice).toBe(0);
    expect(snapshots(data)).toEqual([0]);
  });

  it('dipanggil dua kali dengan angka sama: hasil sama, tanpa galat', async () => {
    const { service, data } = fakeDb({
      ...seed(),
      stockMovement: [sold('t1', 'c1')],
      invoice: [invoice('inv1', 't1')],
      invoiceItem: [line('inv1', null)],
    });
    await service.setCost('c1', { buyPrice: 3000000 }, 'admin');
    const second = await service.setCost('c1', { buyPrice: 3000000 }, 'admin');
    expect(second).toEqual({ status: 'ok', updatedInvoiceNumbers: [] });
    expect(snapshots(data)).toEqual([3000000]);
  });

  it('modal >= harga jual tanpa confirmOverride: confirm_required, tak ada perubahan', async () => {
    const { service, data } = fakeDb(seed());
    const result = await service.setCost('c1', { buyPrice: 4000000 }, 'admin');
    expect(result.status).toBe('confirm_required');
    expect(data.itemCost[0].buyPrice).toBeNull();
    expect(data.auditLog).toHaveLength(0);
    await service.setCost('c1', { buyPrice: 4000000, confirmOverride: true }, 'admin');
    expect(data.itemCost[0].buyPrice).toBe(4000000);
  });

  it('alsoItemCostIds beda barang: ditolak, tak ada perubahan', async () => {
    const { service, data } = fakeDb({ product: [ac], itemCost: [cost('c1', null), cost('x', null, { refId: 'lain' })] });
    await expect(service.setCost('c1', { buyPrice: 100, alsoItemCostIds: ['x'] }, 'admin'))
      .rejects.toThrow(BadRequestException);
    expect(data.itemCost.map((c) => c.buyPrice)).toEqual([null, null]);
  });

  it('batch Outdoor milik paket ditolak', async () => {
    const { service } = fakeDb({
      product: [ac, { id: 'in', name: 'Indoor', sellPrice: 1, pairedProductId: 'ac' }],
      itemCost: [cost('c1', 0)],
    });
    await expect(service.setCost('c1', { buyPrice: 100 }, 'admin')).rejects.toThrow('modal');
  });

  it('mengunci baris sebelum membaca harga lama dan invoice', async () => {
    const { service, calls } = fakeDb({
      sparepart: [{ id: 'sp', name: 'Freon', unit: 'kg', sellPrice: 100000, batchTracked: false }],
      itemCost: [cost('c1', null, { kind: 'sparepart', refId: 'sp' })],
    });
    await service.setCost('c1', { buyPrice: 100 }, 'admin');
    const lockSparepart = calls.findIndex((c) => c.includes('FROM spareparts') && c.includes('FOR UPDATE'));
    const lockCost = calls.findIndex((c) => c.includes('FROM item_costs') && c.includes('FOR UPDATE'));
    expect(lockSparepart).toBeGreaterThanOrEqual(0);
    expect(lockCost).toBeGreaterThan(lockSparepart);
    expect(calls.indexOf('invoiceItem.findMany')).toBeGreaterThan(lockCost);
  });

  it('audit log mencatat harga lama, baru, dan invoice', async () => {
    const { service, data } = fakeDb({
      product: [ac],
      itemCost: [cost('c1', 100)],
      stockMovement: [sold('t1', 'c1')],
      invoice: [invoice('inv1', 't1')],
      invoiceItem: [line('inv1', 100)],
    });
    await service.setCost('c1', { buyPrice: 200 }, 'admin-1');
    expect(data.auditLog[0]).toMatchObject({
      actorUid: 'admin-1',
      action: 'stock.set_cost',
      target: 'ac',
      detail: { itemCostIds: ['c1'], oldBuyPrice: 100, newBuyPrice: 200, invoices: ['INV1'] },
    });
  });
});

describe('StockCostService.list', () => {
  const received = (itemCostId: string, qty: number, extra: Row = {}): Row => ({
    id: `in-${itemCostId}`, itemCostId, reason: 'barang_masuk', qtyChange: qty,
    createdBy: { displayName: 'Budi' }, ...extra,
  });

  it('pending: gulungan satu penerimaan jadi satu baris, Outdoor paket disembunyikan', async () => {
    const { service } = fakeDb({
      sparepart: [{ id: 'sp', name: 'Pipa', unit: 'm', sellPrice: 100000, batchTracked: true }],
      product: [{ id: 'in', name: 'Indoor', sellPrice: 1, pairedProductId: 'out' }, { id: 'out', name: 'Outdoor', sellPrice: 0 }],
      itemCost: [
        cost('r1', null, { kind: 'sparepart', refId: 'sp' }),
        cost('r2', null, { kind: 'sparepart', refId: 'sp' }),
        cost('o1', null, { refId: 'out' }),
        cost('i1', 500, { refId: 'in' }),
      ],
      stockMovement: [received('r1', 15), received('r2', 12)],
    });
    const rows = await service.list({ filter: 'pending' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemCostIds: ['r1', 'r2'], kind: 'sparepart', name: 'Pipa', unit: 'm',
      buyPrice: null, qtyReceived: 27, createdByName: 'Budi',
    });
  });

  it('all: batch yang sudah terisi ikut, sparepart biasa tanpa jumlah', async () => {
    const { service } = fakeDb({
      sparepart: [{ id: 'sp', name: 'Freon', unit: 'kg', sellPrice: 100000 }],
      itemCost: [cost('c1', 700, { kind: 'sparepart', refId: 'sp' })],
    });
    const rows = await service.list({ filter: 'all' });
    expect(rows[0]).toMatchObject({ buyPrice: 700, qtyReceived: null, createdByName: null, sellPrice: 100000 });
  });
});

describe('Endpoint modal', () => {
  it('hanya admin', () => {
    for (const handler of [StockController.prototype.listCosts, StockController.prototype.setCost]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['admin']);
    }
  });
});

describe('StockCostService.setCost — acuan modal jual satuan dari paket', () => {
  const indoor = { id: 'ac', name: 'Indoor', sellPrice: 9000000, pairedProductId: 'out' };
  const single = (invoiceId: string, refId: string, packageCostRef: number | null) =>
    line(invoiceId, 0, { refId, costUnallocated: true, packageCostRef });
  const refs = (data: Record<string, Row[]>) => data.invoiceItem.map((i) => i.packageCostRef);

  it('mengisi modal paket memperbarui acuan Indoor & Outdoor satuan sejak batch masuk', async () => {
    const { service, data } = fakeDb({
      product: [indoor],
      itemCost: [cost('c1', null, { createdAt: later(30) })],
      invoice: [invoice('lama', 't0', { createdAt: later(10) }), invoice('a', 't1'), invoice('b', 't2')],
      invoiceItem: [single('lama', 'out', null), single('a', 'ac', null), single('b', 'out', null)],
    });
    const result = await service.setCost('c1', { buyPrice: 5000000 }, 'admin');
    expect(refs(data)).toEqual([null, 5000000, 5000000]);
    expect(data.invoiceItem.map((i) => i.buyPriceSnapshot)).toEqual([0, 0, 0]);
    expect(result).toMatchObject({ updatedInvoiceNumbers: ['A', 'B'] });
  });

  it('koreksi mengganti acuan yang berharga lama saja', async () => {
    const { service, data } = fakeDb({
      product: [indoor],
      itemCost: [cost('c1', 50000000)],
      invoice: [invoice('a', 't1'), invoice('b', 't2')],
      invoiceItem: [single('a', 'ac', 50000000), single('b', 'out', 4800000)],
    });
    await service.setCost('c1', { buyPrice: 5000000 }, 'admin');
    expect(refs(data)).toEqual([5000000, 4800000]);
  });
});

describe('StockCostService.setCost — kunci produk', () => {
  it('mengunci SEMUA batch produk itu, bukan hanya yang diubah', async () => {
    const { service, calls } = fakeDb({ product: [ac], itemCost: [cost('c1', null)] });
    await service.setCost('c1', { buyPrice: 100 }, 'admin');
    expect(calls[0]).toContain('ref_id = $1');
    expect(calls[0]).toContain('ORDER BY id FOR UPDATE');
  });
});
