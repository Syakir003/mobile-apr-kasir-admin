import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListStatusQueryDto } from './list-status-query.dto';

describe('ListStatusQueryDto', () => {
  it('valid tanpa status sama sekali (default ke active di service)', async () => {
    const dto = plainToInstance(ListStatusQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it.each(['active', 'inactive', 'all'])('valid buat status=%s', async (status) => {
    const dto = plainToInstance(ListStatusQueryDto, { status });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('invalid buat status yang bukan salah satu dari 3 pilihan', async () => {
    const dto = plainToInstance(ListStatusQueryDto, { status: 'deleted' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('status');
  });
});
