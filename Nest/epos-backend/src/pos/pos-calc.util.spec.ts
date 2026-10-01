import { computeTotals, findSingleUnitLineIndexes } from './pos-calc.util';

describe('computeTotals', () => {
  it('subtotal termasuk diskon per-baris (BARU)', () => {
    const totals = computeTotals(
      [{ qty: 1, unitPrice: 3_200_000, discount: 250_000 }],
      0,
      0,
      0,
    );
    expect(totals.subtotal).toBe(2_950_000);
    expect(totals.grandTotal).toBe(2_950_000);
  });

  it('baris tanpa discount dianggap 0 (gak breaking existing behavior)', () => {
    const totals = computeTotals([{ qty: 2, unitPrice: 100_000 }], 0, 0, 0);
    expect(totals.subtotal).toBe(200_000);
  });

  it('diskon level-transaksi tetep numpuk DI ATAS diskon per-baris', () => {
    const totals = computeTotals(
      [{ qty: 1, unitPrice: 1_000_000, discount: 100_000 }],
      50_000,
      10,
      0,
    );
    expect(totals.subtotal).toBe(900_000);
    expect(totals.taxAmount).toBe(85_000);
    expect(totals.grandTotal).toBe(935_000);
  });
});

import { allocateBatchDeductions } from './pos-calc.util';

describe('allocateBatchDeductions', () => {
  it('1 consumer, 1 batch — alokasi langsung', () => {
    const result = allocateBatchDeductions(
      [{ qty: 5, meta: 'cart-item' }],
      [{ itemCostId: 'batch-a', qty: 5 }],
    );
    expect(result).toEqual([{ meta: 'cart-item', itemCostId: 'batch-a', qty: 5 }]);
  });

  it('1 consumer narik dari lebih dari 1 batch (FIFO)', () => {
    const result = allocateBatchDeductions(
      [{ qty: 6, meta: 'cart-item' }],
      [
        { itemCostId: 'roll-lama', qty: 4 },
        { itemCostId: 'roll-baru', qty: 2 },
      ],
    );
    expect(result).toEqual([
      { meta: 'cart-item', itemCostId: 'roll-lama', qty: 4 },
      { meta: 'cart-item', itemCostId: 'roll-baru', qty: 2 },
    ]);
  });

  it('2 consumer (cart item + paket instalasi) berbagi 1 batch yang sama', () => {
    const result = allocateBatchDeductions(
      [
        { qty: 3, meta: 'cart-item' },
        { qty: 2, meta: 'paket-1' },
      ],
      [{ itemCostId: 'roll-a', qty: 5 }],
    );
    expect(result).toEqual([
      { meta: 'cart-item', itemCostId: 'roll-a', qty: 3 },
      { meta: 'paket-1', itemCostId: 'roll-a', qty: 2 },
    ]);
  });

  it('2 consumer, kebutuhan nembus batas antar batch', () => {
    const result = allocateBatchDeductions(
      [
        { qty: 3, meta: 'cart-item' },
        { qty: 4, meta: 'paket-1' },
      ],
      [
        { itemCostId: 'roll-lama', qty: 4 },
        { itemCostId: 'roll-baru', qty: 3 },
      ],
    );
    expect(result).toEqual([
      { meta: 'cart-item', itemCostId: 'roll-lama', qty: 3 },
      { meta: 'paket-1', itemCostId: 'roll-lama', qty: 1 },
      { meta: 'paket-1', itemCostId: 'roll-baru', qty: 3 },
    ]);
  });

  it('lempar Error kalau total qty consumer melebihi total qty deductions (bug pemanggil)', () => {
    expect(() =>
      allocateBatchDeductions(
        [{ qty: 10, meta: 'cart-item' }],
        [{ itemCostId: 'roll-a', qty: 5 }],
      ),
    ).toThrow('allocateBatchDeductions');
  });

  it('array consumer kosong -> hasil kosong, gak manggil batch sama sekali', () => {
    expect(allocateBatchDeductions([], [{ itemCostId: 'roll-a', qty: 5 }])).toEqual([]);
  });
});

describe('findSingleUnitLineIndexes (Paket AC Split)', () => {
  const pairInfo = new Map([
    ['in1', { pairedProductId: 'out1', pairedIndoorId: null }],
    ['out1', { pairedProductId: null, pairedIndoorId: 'in1' }],
    ['solo', { pairedProductId: null, pairedIndoorId: null }],
  ]);

  it('Split (Indoor + Outdoor ber-pairedWithItemIndex) bukan unit satuan', () => {
    const items = [
      { kind: 'product', refId: 'in1' },
      { kind: 'product', refId: 'out1', pairedWithItemIndex: 0 },
    ];
    expect(findSingleUnitLineIndexes(items, pairInfo)).toEqual([]);
  });

  it('Indoor saja / Outdoor saja dari produk berpasangan = unit satuan', () => {
    expect(findSingleUnitLineIndexes([{ kind: 'product', refId: 'in1' }], pairInfo)).toEqual([0]);
    expect(
      findSingleUnitLineIndexes([{ kind: 'service', refId: 'x' }, { kind: 'product', refId: 'out1' }], pairInfo),
    ).toEqual([1]);
  });

  it('produk standalone & produk yang gak ada info pairing-nya bukan unit satuan', () => {
    const items = [
      { kind: 'product', refId: 'solo' },
      { kind: 'product', refId: 'unknown' },
      { kind: 'sparepart', refId: 'in1' },
    ];
    expect(findSingleUnitLineIndexes(items, pairInfo)).toEqual([]);
  });
});
