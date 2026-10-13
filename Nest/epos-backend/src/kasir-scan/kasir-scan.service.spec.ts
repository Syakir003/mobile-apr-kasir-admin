import { BadRequestException } from '@nestjs/common';
import { KasirScanService } from './kasir-scan.service';

type U = { id: string; ref_id: string; item_cost_id: string; unit_code: string; status: string; reserved_for_invoice_id: string | null };

function setup(opts: { scanned: U; reserved?: U[]; movements?: any[]; otherInvoice?: string }) {
  const movements = opts.movements ?? [];
  const calls = { stockUnitUpdate: [] as any[], mvUpdate: [] as any[], mvDelete: [] as any[], mvCreate: [] as any[] };
  const tx: any = {
    product: { findUnique: jest.fn(async () => ({ name: 'Produk Uji' })) },
    stockUnit: {
      findUnique: jest.fn(async () => ({ id: opts.scanned.id })),
      findFirst: jest.fn(async () => ({ id: opts.scanned.id })),
      update: jest.fn(async (a: any) => { calls.stockUnitUpdate.push(a); }),
    },
    invoice: {
      findUnique: jest.fn(async ({ select }: any) => (select?.number ? { number: opts.otherInvoice ?? 'INV-X' } : { transactionId: 'tr1' })),
    },
    stockMovement: {
      findFirst: jest.fn(async ({ where }: any) => movements.find((m) => m.itemCostId === where.itemCostId) ?? null),
      update: jest.fn(async (a: any) => { calls.mvUpdate.push(a); }),
      delete: jest.fn(async (a: any) => { calls.mvDelete.push(a); }),
      create: jest.fn(async (a: any) => { calls.mvCreate.push(a); }),
    },
    auditLog: { create: jest.fn() },
    $queryRawUnsafe: jest.fn(async (sql: string) => {
      if (sql.includes('WHERE id = $1 FOR UPDATE')) return [opts.scanned];
      if (sql.includes("status = 'reserved'") && sql.includes('LIMIT 1')) return (opts.reserved ?? []).slice(0, 1);
      if (sql.includes('COUNT(*)')) return [{ n: BigInt(opts.reserved?.length ?? 0) }];
      return [];
    }),
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { svc: new KasirScanService(prisma), tx, calls };
}

const unit = (o: Partial<U>): U => ({ id: 'x', ref_id: 'p1', item_cost_id: 'b1', unit_code: 'PRD-U1', status: 'di_gudang', reserved_for_invoice_id: null, ...o });

describe('KasirScanService.scanUnit — tukar reservasi', () => {
  it('unit di_gudang beda batch: tukar, unit lama dilepas, movement batch digeser', async () => {
    const { svc, calls } = setup({
      scanned: unit({ id: 'new', item_cost_id: 'b2' }),
      reserved: [unit({ id: 'old', item_cost_id: 'b1', status: 'reserved', reserved_for_invoice_id: 'inv1' })],
      movements: [{ id: 'm1', itemCostId: 'b1', qtyChange: -1, name: 'AC', pairGroupId: null, createdById: 'u', transactionId: 'tr1' }],
    });
    const r: any = await svc.scanUnit({ invoiceId: 'inv1', qrToken: 't' }, 'kasir');
    expect(r.swapped).toBe(true);
    expect(calls.stockUnitUpdate[0].where.id).toBe('old');
    expect(calls.stockUnitUpdate[0].data.status).toBe('di_gudang');
    expect(calls.stockUnitUpdate[0].data.reservedForInvoiceId).toBeNull();
    expect(calls.stockUnitUpdate[1].where.id).toBe('new');
    expect(calls.stockUnitUpdate[1].data.status).toBe('keluar');
    expect(calls.mvDelete).toHaveLength(1);
    expect(calls.mvCreate[0].data.itemCostId).toBe('b2');
  });

  it('sebatch: movement tidak digeser', async () => {
    const { svc, calls } = setup({
      scanned: unit({ id: 'new', item_cost_id: 'b1' }),
      reserved: [unit({ id: 'old', item_cost_id: 'b1', status: 'reserved', reserved_for_invoice_id: 'inv1' })],
    });
    await svc.scanUnit({ invoiceId: 'inv1', qrToken: 't' }, 'kasir');
    expect(calls.mvDelete).toHaveLength(0);
    expect(calls.mvCreate).toHaveLength(0);
  });

  it('movement qty>1 dikurangi, batch tujuan yang sudah ada ditambah', async () => {
    const { svc, calls } = setup({
      scanned: unit({ id: 'new', item_cost_id: 'b2' }),
      reserved: [unit({ id: 'old', item_cost_id: 'b1', status: 'reserved', reserved_for_invoice_id: 'inv1' })],
      movements: [
        { id: 'm1', itemCostId: 'b1', qtyChange: -3, name: 'AC' },
        { id: 'm2', itemCostId: 'b2', qtyChange: -1, name: 'AC' },
      ],
    });
    await svc.scanUnit({ invoiceId: 'inv1', qrToken: 't' }, 'kasir');
    expect(calls.mvUpdate[0]).toEqual({ where: { id: 'm1' }, data: { qtyChange: { increment: 1 } } });
    expect(calls.mvUpdate[1]).toEqual({ where: { id: 'm2' }, data: { qtyChange: { decrement: 1 } } });
  });

  it('tolak unit yang direservasi invoice lain', async () => {
    const { svc } = setup({ scanned: unit({ status: 'reserved', reserved_for_invoice_id: 'invB' }), otherInvoice: 'INV-B' });
    await expect(svc.scanUnit({ invoiceId: 'inv1', qrToken: 't' }, 'k')).rejects.toThrow(/INV-B/);
  });

  it('tolak produk yang tidak ada di invoice', async () => {
    const { svc } = setup({ scanned: unit({}), reserved: [] });
    await expect(svc.scanUnit({ invoiceId: 'inv1', qrToken: 't' }, 'k')).rejects.toBeInstanceOf(BadRequestException);
  });
});
