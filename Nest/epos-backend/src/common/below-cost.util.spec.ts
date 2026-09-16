import { checkBelowCost } from './below-cost.util';

describe('checkBelowCost', () => {
  it('gak kena warning kalau harga efektif di atas modal', () => {
    const result = checkBelowCost({ buyPrice: 2_900_000, sellPrice: 3_000_000 });
    expect(result.isBelowCost).toBe(false);
    expect(result.effectivePrice).toBe(3_000_000);
  });

  it('kena warning kalau harga efektif PERSIS sama modal (breakeven)', () => {
    const result = checkBelowCost({ buyPrice: 3_000_000, sellPrice: 3_000_000 });
    expect(result.isBelowCost).toBe(true);
  });

  it('kena warning kalau harga efektif di bawah modal setelah diskon', () => {
    const result = checkBelowCost({ buyPrice: 3_100_000, sellPrice: 3_200_000, discount: 150_000 });
    expect(result.isBelowCost).toBe(true);
    expect(result.effectivePrice).toBe(3_050_000);
  });

  it('diskon gak diisi dianggap 0', () => {
    const result = checkBelowCost({ buyPrice: 2_000_000, sellPrice: 2_500_000 });
    expect(result.effectivePrice).toBe(2_500_000);
    expect(result.isBelowCost).toBe(false);
  });
});
