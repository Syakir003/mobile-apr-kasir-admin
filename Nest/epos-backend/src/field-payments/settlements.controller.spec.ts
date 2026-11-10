import 'reflect-metadata';
import { SettlementsController } from './settlements.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

const admin = { sub: 'a1', role: 'admin' } as any;

function make() {
  const settlements: any = {
    pending: jest.fn(async () => ({ payments: [] })),
    settle: jest.fn(async () => ({ settlementId: 's1' })),
    repay: jest.fn(async () => ({ saldoSesudah: 0 })),
    technicianCash: jest.fn(async () => []),
    awaiting: jest.fn(async () => ({ items: [], total: 0 })),
    fromPaper: jest.fn(async () => ({ duplicate: false })),
    verify: jest.fn(async () => ({ invoiceStatus: 'lunas' })),
    reject: jest.fn(async () => ({ ok: true })),
  };
  const realtime: any = { emitToAdmin: jest.fn() };
  return { ctrl: new SettlementsController(settlements, realtime), settlements, realtime };
}

describe('SettlementsController', () => {
  it('seluruh controller hanya untuk admin (kasir/teknisi tidak boleh memverifikasi uang)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SettlementsController)).toEqual(['admin']);
  });

  it('meneruskan peminta (admin) ke service', async () => {
    const { ctrl, settlements } = make();
    const dto: any = { technicianId: 't1', paymentIds: ['p1'], receivedTotal: 1 };
    await ctrl.pending('t1', '2026-11-10');
    expect(settlements.pending).toHaveBeenCalledWith('t1', '2026-11-10');
    await ctrl.settle(dto, admin);
    expect(settlements.settle).toHaveBeenCalledWith(dto, 'a1');
    await ctrl.repay({ technicianId: 't1', amount: 5 }, admin);
    expect(settlements.repay).toHaveBeenCalledWith({ technicianId: 't1', amount: 5 }, 'a1');
    await ctrl.fromPaper({ jobId: 'j1' } as any, admin);
    expect(settlements.fromPaper).toHaveBeenCalledWith({ jobId: 'j1' }, 'a1');
    await ctrl.verify('p1', admin);
    expect(settlements.verify).toHaveBeenCalledWith('p1', 'a1');
    await ctrl.reject('p1', { reason: 'tidak masuk mutasi' }, admin);
    expect(settlements.reject).toHaveBeenCalledWith('p1', 'tidak masuk mutasi', 'a1');
    await ctrl.technicianCash();
    await ctrl.awaiting();
    expect(settlements.technicianCash).toHaveBeenCalled();
    expect(settlements.awaiting).toHaveBeenCalled();
  });

  it('pending tanpa technicianId: 400 jelas (bukan galat Prisma)', () => {
    const { ctrl, settlements } = make();
    expect(() => ctrl.pending(undefined as unknown as string, undefined)).toThrow('technicianId wajib');
    expect(settlements.pending).not.toHaveBeenCalled();
  });

  it('tanggal kosong diteruskan sebagai undefined (hari ini)', async () => {
    const { ctrl, settlements } = make();
    await ctrl.pending('t1', '');
    expect(settlements.pending).toHaveBeenCalledWith('t1', undefined);
  });

  it('setoran baru mengabari admin lain lewat realtime', async () => {
    const { ctrl, realtime } = make();
    await ctrl.settle({ technicianId: 't1', paymentIds: ['p1'], receivedTotal: 1 } as any, admin);
    expect(realtime.emitToAdmin).toHaveBeenCalledWith('settlement.created', { settlementId: 's1', technicianId: 't1' });
  });
});
