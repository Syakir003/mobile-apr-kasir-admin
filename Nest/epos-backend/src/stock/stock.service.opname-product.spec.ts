import { StockService } from './stock.service';

// Opname produk AC: ketik jumlah yang benar; unit PALING BARU ditandai 'dihapus'
// (bukan dihapus permanen) dan kodenya dikembalikan supaya labelnya dicabut.

// Urutan dari query: batch & unit TERLAMA dulu.
const units = [
  { id: 'u1', unit_code: 'PRD-0001-U0001', item_cost_id: 'b1' },
  { id: 'u2', unit_code: 'PRD-0001-U0002', item_cost_id: 'b1' },
  { id: 'u3', unit_code: 'PRD-0001-U0003', item_cost_id: 'b2' },
  { id: 'u4', unit_code: 'PRD-0001-U0004', item_cost_id: 'b2' },
];

function setup() {
  const tx = {
    $queryRawUnsafe: jest.fn(async (sql: string) =>
      sql.includes('FROM products') ? [{ name: 'AC Uji' }] : units,
    ),
    $executeRawUnsafe: jest.fn(),
    stockMovement: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { service: new StockService(prisma as never, {} as never, {} as never), tx };
}

const opname = (service: StockService, physicalQty: number) =>
  service.opname({ items: [{ kind: 'product', refId: 'p1', physicalQty }] }, 'g1');

describe('StockService.opname produk AC', () => {
  it('kurang dari catatan: yang terbaru ditandai dihapus, mutasi per batch, kode dikembalikan', async () => {
    const { service, tx } = setup();
    const [result] = (await opname(service, 1)) as any[];

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("status = 'dihapus'"), ['u2', 'u3', 'u4']);
    expect(result).toMatchObject({ systemQty: 4, physicalQty: 1, delta: -3 });
    expect(result.removedUnits).toEqual(['PRD-0001-U0002', 'PRD-0001-U0003', 'PRD-0001-U0004']);
    expect(tx.stockMovement.create.mock.calls.map((c: any[]) => [c[0].data.itemCostId, c[0].data.qtyChange, c[0].data.reason]))
      .toEqual([['b1', -1, 'opname'], ['b2', -2, 'opname']]);
    expect(tx.auditLog.create.mock.calls[0][0].data.detail.removedUnits).toHaveLength(3);
  });

  it('sama dengan catatan: tidak mengubah apa pun', async () => {
    const { service, tx } = setup();
    const [result] = (await opname(service, 4)) as any[];
    expect(result.delta).toBe(0);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('lebih dari catatan: ditolak, diarahkan ke Terima Barang (unit baru butuh QR)', async () => {
    const { service, tx } = setup();
    await expect(opname(service, 5)).rejects.toThrow('Terima Barang');
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('jumlah pecahan ditolak', async () => {
    const { service } = setup();
    await expect(opname(service, 2.5)).rejects.toThrow('bulat');
  });
});
