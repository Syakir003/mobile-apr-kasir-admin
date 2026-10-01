import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CheckoutInstallationDto, CheckoutItemDto } from './checkout.dto';

describe('CheckoutInstallationDto.itemIndexes (Point 2)', () => {
  it('nolak array kosong', async () => {
    const dto = plainToInstance(CheckoutInstallationDto, { itemIndexes: [] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('terima 1 index (unit tunggal)', async () => {
    const dto = plainToInstance(CheckoutInstallationDto, { itemIndexes: [0] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('terima 2 index (mode Lengkap: [indoor, outdoor])', async () => {
    const dto = plainToInstance(CheckoutInstallationDto, { itemIndexes: [0, 1] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('CheckoutItemDto.pairedWithItemIndex (Point 2)', () => {
  it('opsional — item tanpa ini tetap valid', async () => {
    const dto = plainToInstance(CheckoutItemDto, { kind: 'product', refId: 'p1', qty: 1 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('kalau diisi harus integer >= 0', async () => {
    const dto = plainToInstance(CheckoutItemDto, {
      kind: 'product',
      refId: 'p1',
      qty: 1,
      pairedWithItemIndex: -1,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
