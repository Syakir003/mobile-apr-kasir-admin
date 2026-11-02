import { BadRequestException } from '@nestjs/common';
import { AcUnitsService } from './ac-units.service';

const waiting = { id: 'u1', status: 'menunggu_data', labelAttachedAt: null };
const updated = { id: 'u1', memberId: 'm1', brand: 'Daikin', roomLocation: 'Kamar utama', barcodeValue: 'ACUNIT-1' };
const dto = { brand: 'Daikin', pk: 1 } as any;

function setup(unit: any = waiting) {
  const prisma: any = {
    memberAcUnit: { findUnique: jest.fn(async () => unit), update: jest.fn(async () => updated) },
    auditLog: { create: jest.fn() },
    member: { findUnique: jest.fn(async () => ({ name: 'Pak Andi' })) },
    user: { findUnique: jest.fn(async () => ({ displayName: 'Budi Teknisi' })) },
  };
  const notifications: any = { notifyRoles: jest.fn(async () => undefined) };
  const svc = new AcUnitsService(prisma, {} as any, notifications);
  return { svc, notifications };
}

// Notifikasi dikirim fire-and-forget setelah update — beri kesempatan microtask selesai dulu.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('AcUnitsService.completeData — notifikasi admin', () => {
  it('teknisi melengkapi data -> admin dikabari, tautan ke pelanggan', async () => {
    const { svc, notifications } = setup();
    await svc.completeData('u1', dto, 't1', 'teknisi');
    await flush();
    expect(notifications.notifyRoles).toHaveBeenCalledTimes(1);
    const [roles, params] = notifications.notifyRoles.mock.calls[0];
    expect(roles).toEqual(['admin']);
    expect(params).toMatchObject({ type: 'unit_data_completed', target: 'm1' });
    expect(params.body).toContain('Budi Teknisi');
    expect(params.body).toContain('Pak Andi');
    expect(params.body).toContain('Monitoring Jadwal');
  });

  it('admin yang melengkapi sendiri -> tidak ada notifikasi', async () => {
    const { svc, notifications } = setup();
    await svc.completeData('u1', dto, 'a1', 'admin');
    await flush();
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });

  it('data tetap tersimpan walau notifikasi gagal', async () => {
    const { svc, notifications } = setup();
    notifications.notifyRoles.mockRejectedValue(new Error('push down'));
    await expect(svc.completeData('u1', dto, 't1', 'teknisi')).resolves.toMatchObject({ id: 'u1' });
    await flush();
  });

  it('unit yang sudah lengkap ditolak dan tidak memicu notifikasi', async () => {
    const { svc, notifications } = setup({ ...waiting, status: 'aktif' });
    await expect(svc.completeData('u1', dto, 't1', 'teknisi')).rejects.toBeInstanceOf(BadRequestException);
    await flush();
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });
});
