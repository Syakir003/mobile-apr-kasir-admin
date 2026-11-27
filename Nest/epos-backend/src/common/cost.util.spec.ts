import { maxKnownCost, toCost } from './cost.util';

describe('cost.util', () => {
  it('toCost membedakan kosong dari nol', () => {
    expect(toCost(null)).toBeNull();
    expect(toCost(undefined)).toBeNull();
    expect(toCost('0')).toBe(0);
    expect(toCost('2900000.00')).toBe(2900000);
  });

  it('maxKnownCost melewati yang kosong', () => {
    expect(maxKnownCost([null, '100', '300', null])).toBe(300);
    expect(maxKnownCost([null, null])).toBeNull();
    expect(maxKnownCost([])).toBeNull();
  });
});
