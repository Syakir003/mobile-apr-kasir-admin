import { resolveAcUnitPairFields, PairableProduct } from './ac-unit-pair.util';

const indoor: PairableProduct = { id: 'indoor-1', brand: 'Panasonic', type: 'Split Indoor', pk: 1 as any };
const outdoor: PairableProduct = { id: 'outdoor-1', brand: 'Panasonic', type: 'Split Outdoor', pk: 1 as any };
const standalone: PairableProduct = { id: 'std-1', brand: 'LG', type: 'Standing', pk: 2 as any };

describe('resolveAcUnitPairFields', () => {
  it('1 produk tanpa pairedProductId -> indoorProductId/outdoorProductId null dua-duanya', () => {
    const r = resolveAcUnitPairFields([standalone]);
    expect(r.indoorProductId).toBeNull();
    expect(r.outdoorProductId).toBeNull();
    expect(r.brand).toBe('LG');
    expect(r.model).toBe('Standing');
  });

  it('1 produk YANG punya pairedProductId -> dianggap Indoor-nya', () => {
    const r = resolveAcUnitPairFields([{ ...indoor, pairedProductId: outdoor.id }]);
    expect(r.indoorProductId).toBe('indoor-1');
    expect(r.outdoorProductId).toBeNull();
  });

  it('1 produk berperan outdoor -> tercatat sebagai outdoorProductId', () => {
    const r = resolveAcUnitPairFields([{ ...outdoor, acRole: 'outdoor' }]);
    expect(r.indoorProductId).toBeNull();
    expect(r.outdoorProductId).toBe('outdoor-1');
  });

  it('1 produk berperan indoor tanpa pairedProductId -> indoorProductId', () => {
    const r = resolveAcUnitPairFields([{ ...indoor, acRole: 'indoor' }]);
    expect(r.indoorProductId).toBe('indoor-1');
    expect(r.outdoorProductId).toBeNull();
  });

  it('2 produk dengan tipe sama -> model gak ditulis dobel', () => {
    const r = resolveAcUnitPairFields([
      { ...indoor, type: 'Split' },
      { ...outdoor, type: 'Split' },
    ]);
    expect(r.model).toBe('Split');
  });

  it('2 produk -> [0]=Indoor, [1]=Outdoor, model digabung', () => {
    const r = resolveAcUnitPairFields([indoor, outdoor]);
    expect(r.indoorProductId).toBe('indoor-1');
    expect(r.outdoorProductId).toBe('outdoor-1');
    expect(r.brand).toBe('Panasonic');
    expect(r.model).toBe('Split Indoor + Split Outdoor');
    expect(r.pk).toBe(1);
  });

  it('lebih dari 2 produk -> lempar error', () => {
    expect(() => resolveAcUnitPairFields([indoor, outdoor, standalone])).toThrow();
  });

  it('array kosong -> lempar error', () => {
    expect(() => resolveAcUnitPairFields([])).toThrow();
  });
});
