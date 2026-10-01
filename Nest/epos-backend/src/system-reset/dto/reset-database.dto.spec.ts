import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ResetDatabaseDto, RESET_SCOPES, RESET_CONFIRM_TEXT } from './reset-database.dto';

describe('ResetDatabaseDto', () => {
  it.each(RESET_SCOPES)('valid buat scope=%s dengan confirmText string', async (scope) => {
    const dto = plainToInstance(ResetDatabaseDto, { scope, confirmText: 'apa saja' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('invalid buat scope yang bukan salah satu dari 3 pilihan', async () => {
    const dto = plainToInstance(ResetDatabaseDto, {
      scope: 'semua',
      confirmText: 'HAPUS TOTAL',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('scope');
  });

  it('invalid kalau confirmText bukan string', async () => {
    const dto = plainToInstance(ResetDatabaseDto, { scope: 'total', confirmText: 123 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('confirmText');
  });

  it('RESET_CONFIRM_TEXT punya entri buat setiap RESET_SCOPES', () => {
    for (const scope of RESET_SCOPES) {
      expect(typeof RESET_CONFIRM_TEXT[scope]).toBe('string');
      expect(RESET_CONFIRM_TEXT[scope].length).toBeGreaterThan(0);
    }
  });
});
