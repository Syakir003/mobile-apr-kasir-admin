import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StockInDto } from './stock-in.dto';

describe('StockInDto.pairMode/outdoorRefId (Point 2)', () => {
  it('pairMode opsional, default perilaku lama tetap valid', async () => {
    const dto = plainToInstance(StockInDto, { kind: 'product', refId: 'p1', qty: 1, buyPrice: 100 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('pairMode di luar tunggal/lengkap ditolak', async () => {
    const dto = plainToInstance(StockInDto, {
      kind: 'product', refId: 'p1', qty: 1, buyPrice: 100, pairMode: 'ngaco',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('pairMode=lengkap + outdoorRefId valid', async () => {
    const dto = plainToInstance(StockInDto, {
      kind: 'product', refId: 'indoor-1', qty: 1, buyPrice: 100,
      pairMode: 'lengkap', outdoorRefId: 'outdoor-1',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
