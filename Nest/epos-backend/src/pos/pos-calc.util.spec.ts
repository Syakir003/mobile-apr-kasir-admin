import { computeTotals } from './pos-calc.util';

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
