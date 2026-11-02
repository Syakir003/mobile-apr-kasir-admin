import { isUnitLabeled } from './unit-label-status.util';

function db(count: number) {
  return { technicianJob: { count: jest.fn(async () => count) } } as any;
}
const unit = { id: 'u1', labelPrintedAt: null, labelAttachedAt: null };

describe('isUnitLabeled', () => {
  it('sudah dicetak -> terlabel, tanpa query job', async () => {
    const d = db(0);
    expect(await isUnitLabeled(d, { ...unit, labelPrintedAt: new Date() })).toBe(true);
    expect(d.technicianJob.count).not.toHaveBeenCalled();
  });

  it('sudah ditempel -> terlabel', async () => {
    expect(await isUnitLabeled(db(0), { ...unit, labelAttachedAt: new Date() })).toBe(true);
  });

  it('belum pernah ada job -> belum terlabel', async () => {
    expect(await isUnitLabeled(db(0), unit)).toBe(false);
  });

  it('pernah ada job lain -> terlabel', async () => {
    expect(await isUnitLabeled(db(1), unit)).toBe(true);
  });

  it('job dibatalkan tidak dihitung, dan batas waktu `before` diteruskan', async () => {
    const d = db(0);
    const before = new Date('2026-11-01T00:00:00Z');
    await isUnitLabeled(d, unit, before);
    const where = d.technicianJob.count.mock.calls[0][0].where;
    expect(where.unitId).toBe('u1');
    expect(where.status).toEqual({ not: 'dibatalkan' });
    expect(where.createdAt).toEqual({ lt: before });
  });

  it('tanpa `before` tidak membatasi waktu', async () => {
    const d = db(0);
    await isUnitLabeled(d, unit);
    expect(d.technicianJob.count.mock.calls[0][0].where.createdAt).toBeUndefined();
  });
});
