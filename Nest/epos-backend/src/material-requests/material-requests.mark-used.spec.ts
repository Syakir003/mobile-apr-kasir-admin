import { MaterialRequestsService } from './material-requests.service';

const approved = {
  id: 'r1',
  jobId: 'j1',
  status: 'approved',
  usedAt: null,
  invoiceId: null,
  job: { technicianId: 't1', billingDerived: false },
  items: [{ id: 'i1', kind: 'sparepart', refId: 'sp1', name: 'Freon R32', qty: 2, lineTotal: 20000, unitPrice: 10000 }],
};

function setup() {
  const tx: any = {
    $executeRaw: jest.fn(),
    materialRequest: {
      findUnique: jest.fn(async () => approved),
      update: jest.fn(async () => ({ id: 'r1', items: [] })),
    },
    materialRequestItem: { update: jest.fn() },
    stockMovement: { create: jest.fn() },
    invoiceAdjustment: { count: jest.fn(async () => 0) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const stockLocking: any = { lockAndDeduct: jest.fn(async () => ({})) };
  const notifications: any = { notifyLowStock: jest.fn(async () => undefined) };
  const svc = new MaterialRequestsService(prisma, stockLocking, notifications, {} as any);
  return { svc, notifications, stockLocking };
}

describe('MaterialRequestsService.markUsed — stok menipis', () => {
  it('stok sparepart terpotong -> cek stok menipis untuk sparepart itu', async () => {
    const { svc, notifications, stockLocking } = setup();
    await svc.markUsed('r1', 't1', 'teknisi', {});
    expect(stockLocking.lockAndDeduct).toHaveBeenCalledTimes(1);
    expect(notifications.notifyLowStock).toHaveBeenCalledWith(['sp1']);
  });

  it('semua item dilaporkan tidak terpakai (0) -> stok tidak berubah, tidak ada pengecekan', async () => {
    const { svc, notifications, stockLocking } = setup();
    await svc.markUsed('r1', 't1', 'teknisi', { items: [{ itemId: 'i1', qtyUsed: 0 }] });
    expect(stockLocking.lockAndDeduct).not.toHaveBeenCalled();
    expect(notifications.notifyLowStock).not.toHaveBeenCalled();
  });
});
