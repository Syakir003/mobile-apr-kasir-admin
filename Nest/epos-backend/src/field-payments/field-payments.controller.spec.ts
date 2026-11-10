import { BadRequestException } from '@nestjs/common';
import { FieldPaymentsController } from './field-payments.controller';

jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

function make() {
  const payment = { id: 'fp1', receiptNumber: 'TT-20261107-0012', method: 'tunai', amount: 150000, status: 'dipegang_teknisi' };
  const service: any = {
    record: jest.fn(async () => ({ payment, duplicate: false })),
    sendReceipt: jest.fn(async () => ({ sent: true, channel: 'wa' })),
    listForJob: jest.fn(async () => ({ payments: [] })),
    mine: jest.fn(async () => ({ heldTotal: 0, items: [] })),
  };
  const realtime: any = { emitToAdmin: jest.fn() };
  const notifications: any = { notifyRoles: jest.fn(async () => undefined) };
  const prisma: any = { technicianJob: { findUnique: jest.fn(async () => ({ member: { name: 'Bu Sari' }, technician: { displayName: 'Budi' } })) } };
  return { ctrl: new FieldPaymentsController(service, realtime, notifications, prisma), service, realtime, notifications };
}

const user = { sub: 't1', role: 'teknisi' } as any;
const file = { filename: 'abc.jpg' } as Express.Multer.File;

describe('FieldPaymentsController', () => {
  it('POST field-payments: wajib ada foto bukti', async () => {
    const { ctrl, service } = make();
    await expect(ctrl.record('j1', { method: 'tunai', amount: 150000 } as any, undefined as any, user)).rejects.toThrow(BadRequestException);
    expect(service.record).not.toHaveBeenCalled();
  });

  it('POST field-payments: simpan path bukti, kabari admin lewat realtime + notifikasi', async () => {
    const { ctrl, service, realtime, notifications } = make();
    const dto: any = { method: 'transfer', amount: 150000 };
    const r = await ctrl.record('j1', dto, file, user);
    expect(service.record).toHaveBeenCalledWith('j1', dto, '/uploads/payment-proofs/abc.jpg', 't1');
    expect(realtime.emitToAdmin).toHaveBeenCalledWith('field_payment.created', { paymentId: 'fp1', jobId: 'j1' });
    const [roles, payload] = notifications.notifyRoles.mock.calls[0];
    expect(roles).toEqual(['admin']);
    expect(payload).toMatchObject({ type: 'field_payment', target: 'fp1', title: 'Pembayaran Lapangan Dicatat' });
    expect(payload.body).toContain('Budi');
    expect(payload.body).toContain('TT-20261107-0012');
    expect(r).toMatchObject({ payment: { id: 'fp1' }, duplicate: false });
  });

  it('POST field-payments: permintaan ulang (duplikat) tidak mengabari admin lagi', async () => {
    const { ctrl, service, realtime, notifications } = make();
    service.record.mockResolvedValueOnce({ payment: { id: 'fp0' }, duplicate: true });
    await ctrl.record('j1', { method: 'tunai', amount: 1 } as any, file, user);
    expect(realtime.emitToAdmin).not.toHaveBeenCalled();
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });

  it('send-receipt, daftar job, dan mine meneruskan peminta ke service', async () => {
    const { ctrl, service } = make();
    await ctrl.sendReceipt('fp1', { channel: 'kertas' } as any, user);
    expect(service.sendReceipt).toHaveBeenCalledWith('fp1', { channel: 'kertas' }, 't1', 'teknisi');
    await ctrl.listForJob('j1', user);
    expect(service.listForJob).toHaveBeenCalledWith('j1', 't1', 'teknisi');
    await ctrl.mine('dipegang_teknisi', user);
    expect(service.mine).toHaveBeenCalledWith('t1', 'dipegang_teknisi');
  });
});
