import { BadRequestException } from '@nestjs/common';
import { resolveSparepartMode } from './sparepart-mode.util';

describe('resolveSparepartMode', () => {
  it('tanpa trackingMode & batchTracked => biasa', () => {
    expect(resolveSparepartMode({})).toEqual({
      trackingMode: 'biasa', batchTracked: false, packUnit: null, packSize: null, sellPricePack: null,
    });
  });

  it('klien lama: batchTracked true => gulungan', () => {
    expect(resolveSparepartMode({ batchTracked: true }).trackingMode).toBe('gulungan');
    expect(resolveSparepartMode({ batchTracked: true }).batchTracked).toBe(true);
  });

  it('klien lama pada gabungan: batchTracked true tetap gabungan, field kemasan diwarisi', () => {
    const r = resolveSparepartMode(
      { batchTracked: true },
      { trackingMode: 'gabungan', batchTracked: true, packUnit: 'roll', packSize: 15, sellPricePack: 900000 },
    );
    expect(r).toEqual({ trackingMode: 'gabungan', batchTracked: true, packUnit: 'roll', packSize: 15, sellPricePack: 900000 });
  });

  it('gulungan/biasa menghapus field kemasan', () => {
    const r = resolveSparepartMode({ trackingMode: 'gulungan', packUnit: 'roll', packSize: 15, sellPricePack: 1 });
    expect(r.packUnit).toBeNull();
    expect(r.packSize).toBeNull();
    expect(r.sellPricePack).toBeNull();
  });

  it('konversi valid => batchTracked false, gabungan valid => batchTracked true', () => {
    const base = { packUnit: 'dus', packSize: 100, sellPricePack: 50000 };
    expect(resolveSparepartMode({ trackingMode: 'konversi', ...base }).batchTracked).toBe(false);
    expect(resolveSparepartMode({ trackingMode: 'gabungan', ...base }).batchTracked).toBe(true);
  });

  it('konversi/gabungan wajib packUnit, packSize>0, harga utuh>0', () => {
    expect(() => resolveSparepartMode({ trackingMode: 'konversi', packSize: 10, sellPricePack: 1 })).toThrow(BadRequestException);
    expect(() => resolveSparepartMode({ trackingMode: 'konversi', packUnit: 'roll', packSize: 0, sellPricePack: 1 })).toThrow(BadRequestException);
    expect(() => resolveSparepartMode({ trackingMode: 'gabungan', packUnit: 'roll', packSize: 15 })).toThrow(BadRequestException);
    expect(() => resolveSparepartMode({ trackingMode: 'gabungan', packUnit: 'roll', packSize: 15, sellPricePack: 0 })).toThrow(BadRequestException);
  });

  it('packSize lebih dari 2 desimal ditolak; mode asing ditolak', () => {
    expect(() => resolveSparepartMode({ trackingMode: 'konversi', packUnit: 'roll', packSize: 1.234, sellPricePack: 1 })).toThrow(BadRequestException);
    expect(() => resolveSparepartMode({ trackingMode: 'xyz' })).toThrow(BadRequestException);
  });
});
