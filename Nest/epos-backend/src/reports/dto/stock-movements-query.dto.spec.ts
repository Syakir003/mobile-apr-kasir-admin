import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StockMovementsQueryDto } from './stock-movements-query.dto';

describe('StockMovementsQueryDto (Point 4)', () => {
  it('valid cuma from/to (kind/refId/category opsional)', async () => {
    const dto = plainToInstance(StockMovementsQueryDto, { from: '2026-09-01', to: '2026-09-23' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('valid dgn semua filter opsional keisi', async () => {
    const dto = plainToInstance(StockMovementsQueryDto, {
      from: '2026-09-01',
      to: '2026-09-23',
      kind: 'sparepart',
      refId: 'sp-1',
      category: 'Pipa',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('kind di luar product/sparepart ditolak', async () => {
    const dto = plainToInstance(StockMovementsQueryDto, {
      from: '2026-09-01',
      to: '2026-09-23',
      kind: 'jasa',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('from/to wajib', async () => {
    const dto = plainToInstance(StockMovementsQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
