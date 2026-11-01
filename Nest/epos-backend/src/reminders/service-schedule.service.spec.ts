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

// ---- monitoring per pelanggan ----

const MEMBERS: Record<string, string> = { m1: 'Budi', m2: 'Sari' };

function acUnit(id: string, memberId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    memberId,
    status: 'aktif',
    reminderEnabled: true,
    nextServiceDate: null,
    serviceIntervalDays: null,
    brand: null,
    model: null,
    member: { id: memberId, name: MEMBERS[memberId], phone: '081234567890', waOptOut: false, active: true },
    indoorProduct: null,
    outdoorProduct: null,
    ...over,
  };
}

function buildList(opts: { groups: string[]; units: unknown[]; logs?: unknown[]; jobs?: unknown[]; total?: number }) {
  const prisma = {
    memberAcUnit: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue(opts.groups.map((memberId) => ({ memberId }))),
      findMany: jest.fn().mockResolvedValue(opts.units),
    },
    member: { count: jest.fn().mockResolvedValue(opts.total ?? opts.groups.length) },
    whatsappLog: { findMany: jest.fn().mockResolvedValue(opts.logs ?? []) },
    technicianJob: { findMany: jest.fn().mockResolvedValue(opts.jobs ?? []) },
  };
  const svc = new ServiceScheduleService(prisma as never, {} as never, {} as never);
  return { svc, prisma };
}

describe('ServiceScheduleService.scheduleByMember', () => {
  it('satu baris per pelanggan, urutan mengikuti pengelompokan, ringkasan memuat semua AC-nya', async () => {
    const { svc, prisma } = buildList({
      groups: ['m2', 'm1'],
      total: 45,
      units: [
        acUnit('u1', 'm1', { nextServiceDate: future() }), // segera
        acUnit('u2', 'm1', { status: 'dalam_maintenance' }), // siklus_kosong + tersangkut
        acUnit('u3', 'm2', { reminderEnabled: false }), // mati
      ],
    });

    const res = await svc.scheduleByMember({ page: 2 });

    expect(prisma.memberAcUnit.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['memberId'],
      skip: 20,
      take: 20,
      orderBy: [{ _min: { nextServiceDate: 'asc' } }, { memberId: 'asc' }],
    });
    expect(res).toMatchObject({ total: 45, page: 2, pageSize: 20, totalPages: 3 });
    expect(res.items.map((i) => i.memberId)).toEqual(['m2', 'm1']);

    const [sari, budi] = res.items;
    expect(sari).toMatchObject({ name: 'Sari', unitCount: 1, nextService: null, bukanAktifCount: 0 });
    expect(sari.counts.mati).toBe(1);
    expect(budi).toMatchObject({ name: 'Budi', unitCount: 2, bukanAktifCount: 1, jobBerjalanCount: 0 });
    expect(budi.counts.segera).toBe(1);
    expect(budi.counts.siklus_kosong).toBe(1);
    expect(budi.nextService?.status).toBe('segera');
  });

  it('jadwal terdekat = tanggal paling awal, termasuk yang sudah terlambat', async () => {
    const lewat = past();
    const { svc } = buildList({
      groups: ['m1'],
      units: [
        acUnit('u1', 'm1', { nextServiceDate: new Date(Date.now() + 20 * 86400000) }),
        acUnit('u2', 'm1', { nextServiceDate: lewat }),
      ],
    });

    const res = await svc.scheduleByMember({});

    expect(res.items[0].nextService).toEqual({ date: lewat, status: 'terlambat' });
  });

  it('unit dalam_maintenance yang punya job berjalan tidak dianggap tersangkut', async () => {
    const { svc } = buildList({
      groups: ['m1'],
      units: [acUnit('u1', 'm1', { status: 'dalam_maintenance' })],
      jobs: [{ unitId: 'u1' }],
    });

    const res = await svc.scheduleByMember({});

    expect(res.items[0]).toMatchObject({ jobBerjalanCount: 1, bukanAktifCount: 0 });
  });

  it('WA terakhir diambil per pelanggan', async () => {
    const at = new Date('2026-10-23T02:00:00Z');
    const { svc } = buildList({
      groups: ['m1', 'm2'],
      units: [acUnit('u1', 'm1'), acUnit('u3', 'm2')],
      logs: [{ memberId: 'm1', kind: 'reminder_h3', status: 'terkirim', error: null, createdAt: at }],
    });

    const res = await svc.scheduleByMember({});

    expect(res.items[0].lastWa).toEqual({ kind: 'reminder_h3', status: 'terkirim', error: null, at });
    expect(res.items[1].lastWa).toBeNull();
  });

  it('halaman kosong tidak menjalankan query AC, WA, maupun job', async () => {
    const { svc, prisma } = buildList({ groups: [], units: [], total: 0 });

    const res = await svc.scheduleByMember({});

    expect(res.items).toEqual([]);
    expect(prisma.memberAcUnit.findMany).not.toHaveBeenCalled();
    expect(prisma.whatsappLog.findMany).not.toHaveBeenCalled();
    expect(prisma.technicianJob.findMany).not.toHaveBeenCalled();
  });

  it('pencarian hanya memilih pelanggan; AC yang dimuat tetap semua AC pelanggan itu', async () => {
    const { svc, prisma } = buildList({ groups: ['m1'], units: [acUnit('u1', 'm1')] });

    await svc.scheduleByMember({ q: 'daikin' });

    expect(prisma.memberAcUnit.groupBy.mock.calls[0][0].where.OR).toBeDefined();
    const unitsWhere = prisma.memberAcUnit.findMany.mock.calls[0][0].where;
    expect(unitsWhere.AND[0].OR).toBeUndefined();
    expect(unitsWhere.AND[1]).toEqual({ memberId: { in: ['m1'] } });
  });

  it('filter status meneruskan kondisi status ke pengelompokan dan hitungan pelanggan', async () => {
    const { svc, prisma } = buildList({ groups: ['m1'], units: [acUnit('u1', 'm1')] });

    await svc.scheduleByMember({ status: 'terlambat' });

    const where = prisma.memberAcUnit.groupBy.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(2);
    expect(prisma.member.count.mock.calls[0][0]).toEqual({ where: { acUnits: { some: where } } });
  });
});

describe('ServiceScheduleService.schedule (filter pelanggan)', () => {
  it('memberId membatasi daftar AC ke satu pelanggan', async () => {
    const { svc, prisma } = buildList({ groups: [], units: [] });

    await svc.schedule({ memberId: 'm1', pageSize: 100 });

    expect(prisma.memberAcUnit.findMany.mock.calls[0][0].where.memberId).toBe('m1');
  });
});
