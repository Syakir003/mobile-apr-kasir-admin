import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ServiceOrdersService } from './service-orders.service';
import { UpdateServiceOrderDto } from './dto/update-service-order.dto';
import { MAPS_SEARCH_PREFIX } from '../common/maps-url.util';

// @nestjs/schedule ESM-only; terseret lewat technician-jobs -> reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Koreksi data order oleh admin: jadwal, jenis pekerjaan, Note Pekerjaan (seluruh order), titik lokasi kerja per unit.
const job = (id: string, status = 'assigned', extra: Record<string, unknown> = {}) => ({
  id,
  status,
  type: 'perbaikan',
  workAddress: null,
  workMapsUrl: null,
  ...extra,
});
const order = (units: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'o1',
  type: 'perbaikan',
  note: 'catatan lama',
  scheduledDate: new Date('2026-11-06'),
  units,
  ...extra,
});

function setup(found: unknown) {
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    serviceOrder: { findUnique: jest.fn(async () => found), update: jest.fn(async () => ({})) },
    technicianJob: { updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const svc = new ServiceOrdersService(prisma, {} as any, {} as any, {} as any);
  return { svc, tx, prisma };
}

describe('ServiceOrdersService.update — jadwal, jenis pekerjaan, note', () => {
  it('jadwal + jenis + note diterapkan ke order dan SEMUA job yang belum selesai, dan dicatat di audit log', async () => {
    const { svc, tx } = setup(order([job('j1'), job('j2', 'sedang_dikerjakan'), job('j3', 'selesai')]));
    const res = await svc.update('o1', { scheduledDate: '2026-11-12', jobType: 'cuci', note: '  Cuci rutin  ' }, 'admin1');

    expect(tx.serviceOrder.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { scheduledDate: new Date('2026-11-12'), type: 'cuci', note: 'Cuci rutin' },
    });
    const um = tx.technicianJob.updateMany.mock.calls[0][0];
    expect(um.where).toEqual({ orderId: 'o1', status: { notIn: ['selesai', 'dibatalkan'] } });
    expect(um.data).toMatchObject({ scheduledDate: new Date('2026-11-12'), type: 'cuci' });
    expect(um.data.note).toBeUndefined();
    expect(res).toEqual({ ok: true, orderId: 'o1', updatedJobs: 2 });

    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ actorUid: 'admin1', action: 'order.update', target: 'o1' });
    expect(audit.detail.changes.scheduledDate).toEqual({ dari: '2026-11-06T00:00:00.000Z', jadi: '2026-11-12T00:00:00.000Z' });
    expect(audit.detail.changes.jobType).toEqual({ dari: 'perbaikan', jadi: 'cuci' });
    expect(audit.detail.changes.note).toEqual({ dari: 'catatan lama', jadi: 'Cuci rutin' });
    expect(audit.detail.jobIds).toEqual(['j1', 'j2']);
  });

  it('note kosong/spasi menghapus note (null)', async () => {
    const { svc, tx } = setup(order([job('j1')]));
    await svc.update('o1', { note: '   ' }, 'admin1');
    expect(tx.serviceOrder.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { note: null } });
    expect(tx.technicianJob.updateMany).not.toHaveBeenCalled(); // note hanya milik order, job tidak disentuh
  });

  it('tanpa satu pun perubahan ditolak sebelum transaksi dimulai', async () => {
    const { svc, prisma } = setup(order([job('j1')]));
    await expect(svc.update('o1', {}, 'admin1')).rejects.toThrow('Tidak ada perubahan');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('order tidak ada = 404', async () => {
    const { svc } = setup(null);
    await expect(svc.update('x', { note: 'a' }, 'admin1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('order yang semua jobnya selesai/dibatalkan tidak bisa diubah', async () => {
    const { svc, tx } = setup(order([job('j1', 'selesai'), job('j2', 'dibatalkan')]));
    await expect(svc.update('o1', { scheduledDate: '2026-11-12' }, 'admin1')).rejects.toThrow('sudah selesai atau dibatalkan');
    expect(tx.serviceOrder.update).not.toHaveBeenCalled();
  });

  it('jenis pekerjaan order pemasangan tidak bisa diganti, tetapi jadwal/note tetap boleh', async () => {
    const { svc, tx } = setup(order([job('j1', 'assigned', { type: 'pemasangan' })], { type: 'pemasangan' }));
    await expect(svc.update('o1', { jobType: 'cuci' }, 'admin1')).rejects.toThrow('pemasangan tidak bisa diganti');
    await expect(svc.update('o1', { scheduledDate: '2026-11-12', note: 'Bawa tangga' }, 'admin1')).resolves.toMatchObject({ ok: true });
    expect(tx.serviceOrder.update).toHaveBeenCalledTimes(1);
  });
});

describe('ServiceOrdersService.update — order komplain', () => {
  it('jenis pekerjaan job komplain tidak bisa diganti, tetapi jadwal/note tetap boleh', async () => {
    const { svc, tx } = setup(order([job('j1', 'assigned', { complaintOfJobId: 'j-awal' })]));
    await expect(svc.update('o1', { jobType: 'cuci' }, 'admin1')).rejects.toThrow('job komplain tidak bisa diganti');
    await expect(svc.update('o1', { scheduledDate: '2026-11-12', note: 'Bawa tangga' }, 'admin1')).resolves.toMatchObject({ ok: true });
    expect(tx.serviceOrder.update).toHaveBeenCalledTimes(1);
  });
});

describe('ServiceOrdersService.update — titik lokasi kerja per unit', () => {
  it('mengubah titik tiap unit; alamat/link dirapikan dan kosong = ikut alamat pelanggan (null)', async () => {
    const { svc, tx } = setup(order([job('j1', 'assigned', { workAddress: 'Lama' }), job('j2')]));
    await svc.update(
      'o1',
      { unitLocations: [{ jobId: 'j1', address: '  Ruko Gedeg  ', mapsUrl: 'https://maps.app.goo.gl/abc' }, { jobId: 'j2' }] },
      'admin1',
    );
    const calls = tx.technicianJob.update.mock.calls.map((c: any) => c[0]);
    expect(calls[0]).toMatchObject({ where: { id: 'j1' }, data: { workAddress: 'Ruko Gedeg', workMapsUrl: 'https://maps.app.goo.gl/abc' } });
    expect(calls[1]).toMatchObject({ where: { id: 'j2' }, data: { workAddress: null, workMapsUrl: null } });
    const lokasi = tx.auditLog.create.mock.calls[0][0].data.detail.changes.lokasiKerja;
    expect(lokasi[0]).toMatchObject({ jobId: 'j1', dari: { workAddress: 'Lama' }, jadi: { workAddress: 'Ruko Gedeg' } });
    expect(tx.serviceOrder.update).not.toHaveBeenCalled(); // hanya lokasi: order tidak ikut diubah
  });

  it('unit yang bukan bagian order ini atau jobnya sudah selesai ditolak', async () => {
    const { svc, tx } = setup(order([job('j1'), job('j2', 'selesai')]));
    await expect(svc.update('o1', { unitLocations: [{ jobId: 'orang-lain', address: 'x' }] }, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('o1', { unitLocations: [{ jobId: 'j2', address: 'x' }] }, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
  });

  it('titik satu unit dikirim dua kali ditolak', async () => {
    const { svc } = setup(order([job('j1')]));
    await expect(svc.update('o1', { unitLocations: [{ jobId: 'j1', address: 'a' }, { jobId: 'j1', address: 'b' }] }, 'admin1')).rejects.toThrow('lebih dari sekali');
  });
});

describe('UpdateServiceOrderDto — validasi', () => {
  const errs = async (plain: object) => validate(plainToInstance(UpdateServiceOrderDto, plain), { whitelist: true });
  const on = async (plain: object, property: string) => (await errs(plain)).filter((e) => e.property === property);

  it('jadwal: boleh diganti tetapi tidak boleh dikosongkan atau berformat salah', async () => {
    expect(await on({ scheduledDate: '2026-11-12' }, 'scheduledDate')).toHaveLength(0);
    expect(await on({}, 'scheduledDate')).toHaveLength(0); // tidak dikirim = tidak diubah
    expect(await on({ scheduledDate: '' }, 'scheduledDate')).toHaveLength(1);
    expect(await on({ scheduledDate: 'besok' }, 'scheduledDate')).toHaveLength(1);
  });

  it('jenis pekerjaan: hanya perbaikan/cuci/maintenance', async () => {
    for (const t of ['perbaikan', 'cuci', 'maintenance']) expect(await on({ jobType: t }, 'jobType')).toHaveLength(0);
    expect(await on({ jobType: 'pemasangan' }, 'jobType')).toHaveLength(1);
    expect(await on({ jobType: 'asal' }, 'jobType')).toHaveLength(1);
  });

  it('titik lokasi: jobId wajib, link ketikan biasa dinormalkan jadi link pencarian Maps', async () => {
    const dto = plainToInstance(UpdateServiceOrderDto, { unitLocations: [{ jobId: 'j1', address: 'Ruko', mapsUrl: 'Mojokerto kota' }] });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.unitLocations?.[0].mapsUrl).toBe(MAPS_SEARCH_PREFIX + 'Mojokerto%20kota');
    expect(await errs({ unitLocations: [{ address: 'tanpa jobId' }] })).not.toHaveLength(0);
  });
});
