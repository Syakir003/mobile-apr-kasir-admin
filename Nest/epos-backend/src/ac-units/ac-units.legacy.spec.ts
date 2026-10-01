import { BadRequestException } from '@nestjs/common';
import { AcUnitsService } from './ac-units.service';

function setup() {
  const created: any[] = [];
  const tx: any = {
    memberAcUnit: { create: jest.fn(async ({ data }) => { created.push(data); return { id: 'u1', ...data }; }) },
    product: { findUnique: jest.fn(async ({ where }) => (where.id === 'p-in' ? { id: 'p-in', brand: 'Daikin', type: 'Split', pk: 1, pairedProductId: 'p-out', acRole: 'indoor' } : null)) },
  };
  const counters: any = { dateKey: () => '20261001', nextSeq: jest.fn(async () => 7) };
  const svc = new AcUnitsService({} as any, counters);
  return { svc, tx, created };
}

describe('AcUnitsService.createLegacy', () => {
  it('mode qr_dulu: status menunggu_data, tipe kosong, pengingat OFF', async () => {
    const { svc, tx, created } = setup();
    await svc.createLegacy(tx, 'm1', { mode: 'qr_dulu', roomLocation: ' Kamar ' });
    expect(created[0]).toMatchObject({
      memberId: 'm1', status: 'menunggu_data', reminderEnabled: false, roomLocation: 'Kamar', barcodeValue: 'ACUNIT-20261001-0007',
    });
    expect(created[0].brand).toBeUndefined();
  });

  it('mode diketahui + siklus: pengingat ON, next = last + siklus', async () => {
    const { svc, tx, created } = setup();
    await svc.createLegacy(tx, 'm1', {
      mode: 'diketahui', brand: 'LG', pk: 1, lastServiceDate: '2026-06-01', serviceIntervalDays: 90,
    });
    expect(created[0].status).toBe('aktif');
    expect(created[0].reminderEnabled).toBe(true);
    expect(created[0].serviceIntervalDays).toBe(90);
    expect(created[0].nextServiceDate.toISOString().slice(0, 10)).toBe('2026-08-30');
  });

  it('mode diketahui tanpa siklus: pengingat OFF, next null', async () => {
    const { svc, tx, created } = setup();
    await svc.createLegacy(tx, 'm1', { mode: 'diketahui', brand: 'LG' });
    expect(created[0].reminderEnabled).toBe(false);
    expect(created[0].nextServiceDate).toBeNull();
  });

  it('saklar ON tanpa siklus ditolak', async () => {
    const { svc, tx } = setup();
    await expect(
      svc.createLegacy(tx, 'm1', { mode: 'diketahui', brand: 'LG', reminderEnabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('diketahui tanpa merk/model/produk ditolak', async () => {
    const { svc, tx } = setup();
    await expect(svc.createLegacy(tx, 'm1', { mode: 'diketahui' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pilih produk master: brand/pk/indoorProductId terisi', async () => {
    const { svc, tx, created } = setup();
    await svc.createLegacy(tx, 'm1', { mode: 'diketahui', indoorProductId: 'p-in' });
    expect(created[0]).toMatchObject({ brand: 'Daikin', model: 'Split', indoorProductId: 'p-in' });
  });

  it('produk tidak ditemukan ditolak', async () => {
    const { svc, tx } = setup();
    await expect(svc.createLegacy(tx, 'm1', { mode: 'diketahui', indoorProductId: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
