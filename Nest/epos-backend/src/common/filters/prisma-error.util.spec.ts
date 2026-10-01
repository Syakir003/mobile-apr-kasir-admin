import { Prisma } from '@prisma/client';
import { mapPrismaError } from './prisma-error.util';

function err(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '7', meta });
}

describe('mapPrismaError', () => {
  it('P2002 format driver adapter: pesan pakai label constraint', () => {
    const r = mapPrismaError(
      err('P2002', { driverAdapterError: { cause: { constraint: { index: 'spareparts_sku_key' } } } }),
    );
    expect(r.status).toBe(409);
    expect(r.message).toContain('SKU sparepart');
  });

  it('P2002 format meta.target (engine biasa) & constraint tak dikenal => pesan generik 409', () => {
    expect(mapPrismaError(err('P2002', { target: ['email'] })).status).toBe(409);
    expect(mapPrismaError(err('P2002', { target: 'users_email_key' })).message).toContain('Email');
    expect(mapPrismaError(err('P2002')).message).toContain('nilai yang sama');
  });

  it('P2025 => 404, P2003 => 409, P2000 => 400, P2034 => 409', () => {
    expect(mapPrismaError(err('P2025')).status).toBe(404);
    expect(mapPrismaError(err('P2003')).status).toBe(409);
    expect(mapPrismaError(err('P2000')).status).toBe(400);
    expect(mapPrismaError(err('P2034')).status).toBe(409);
  });

  it('kode lain => 500 dengan pesan ramah (bukan teks Prisma)', () => {
    const r = mapPrismaError(err('P9999'));
    expect(r.status).toBe(500);
    expect(r.message).not.toMatch(/prisma/i);
  });
});
