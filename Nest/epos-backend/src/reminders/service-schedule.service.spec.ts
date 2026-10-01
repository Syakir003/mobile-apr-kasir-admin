jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ServiceScheduleService } from './service-schedule.service';

const future = () => new Date(Date.now() + 5 * 86400000);
const past = () => new Date(Date.now() - 5 * 86400000);

function unit(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    memberId: 'm1',
    status: 'aktif',
    reminderEnabled: true,
    nextServiceDate: future(),
    member: { id: 'm1', name: 'Budi', phone: '081234567890', waOptOut: false, active: true },
    ...over,
  };
}

function build(u: unknown, recent: unknown = null) {
  const prisma = {
    memberAcUnit: { findUnique: jest.fn().mockResolvedValue(u) },
    whatsappLog: { findFirst: jest.fn().mockResolvedValue(recent) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const whatsapp = {
    createPendingTx: jest.fn().mockResolvedValue({ id: 'log1' }),
    sendPendingLog: jest.fn().mockResolvedValue({ status: 'terkirim', error: null, sentAt: new Date() }),
  };
  const reminders = { buildBodyTx: jest.fn().mockResolvedValue('isi pesan') };
  const svc = new ServiceScheduleService(prisma as never, whatsapp as never, reminders as never);
  return { svc, prisma, whatsapp, reminders };
}

describe('ServiceScheduleService.sendNow', () => {
  it('unit tidak ada -> 404', async () => {
    await expect(build(null).svc.sendNow('x', 'a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['belum dipasang', { status: 'menunggu_pemasangan' }],
    ['pengingat mati', { reminderEnabled: false }],
    ['tanpa jadwal', { nextServiceDate: null }],
    ['opt-out', { member: { id: 'm1', name: 'B', phone: '0812345678', waOptOut: true, active: true } }],
    ['tanpa HP valid', { member: { id: 'm1', name: 'B', phone: null, waOptOut: false, active: true } }],
    ['member nonaktif', { member: { id: 'm1', name: 'B', phone: '0812345678', waOptOut: false, active: false } }],
  ])('ditolak 400: %s', async (_n, over) => {
    const { svc, whatsapp } = build(unit(over));
    await expect(svc.sendNow('u1', 'a')).rejects.toBeInstanceOf(BadRequestException);
    expect(whatsapp.createPendingTx).not.toHaveBeenCalled();
  });

  it('dobel < 24 jam -> 409', async () => {
    const { svc, whatsapp } = build(unit(), { createdAt: new Date() });
    await expect(svc.sendNow('u1', 'a')).rejects.toBeInstanceOf(ConflictException);
    expect(whatsapp.createPendingTx).not.toHaveBeenCalled();
  });

  it('jadwal depan -> template h3, dikirim & diaudit', async () => {
    const { svc, whatsapp, reminders, prisma } = build(unit());
    const res = await svc.sendNow('u1', 'admin1');
    expect(reminders.buildBodyTx.mock.calls[0][2]).toBe('reminder_h3');
    expect(whatsapp.createPendingTx.mock.calls[0][1]).toMatchObject({
      kind: 'reminder_h3',
      unitIds: ['u1'],
      phone: '6281234567890',
      sentById: 'admin1',
    });
    expect(whatsapp.sendPendingLog).toHaveBeenCalledWith('log1');
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(res.status).toBe('terkirim');
  });

  it('jadwal lewat -> template h7', async () => {
    const { svc, reminders } = build(unit({ nextServiceDate: past() }));
    await svc.sendNow('u1', 'a');
    expect(reminders.buildBodyTx.mock.calls[0][2]).toBe('reminder_h7');
  });
});
