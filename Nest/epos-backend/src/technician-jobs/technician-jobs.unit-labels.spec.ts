import { TechnicianJobsService } from './technician-jobs.service';
import { AcUnitLabelsService } from '../ac-units/ac-unit-labels.service';

// Guard akses job kini berbasis tabel assignees (semua teknisi job setara); di tes ini pemilik job = 't1'.
const ownerAssignee = {
  count: jest.fn(async ({ where }: any) => (where.technicianId === 't1' ? 1 : 0)),
};


// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Label QR unit memuat alamat. Satu member bisa punya AC di beberapa tempat (titik lokasi kerja per job), jadi alamat di
// label harus titik kerja unit itu; kosong = ikut alamat member (dikerjakan sisi web).
describe('TechnicianJobsService.unitLabels — alamat kerja per unit', () => {
  it('tiap unit membawa workAddress dari job-nya di order itu (null = ikut alamat member); job dibatalkan tidak dipakai', async () => {
    const prisma: any = {
      technicianJobAssignee: ownerAssignee,
      technicianJob: {
        findUnique: jest.fn(async () => ({ orderId: 'o1', technicianId: 't1', member: { id: 'm1', name: 'Bu Sari', address: 'Jl. Melati' } })),
        findMany: jest.fn(async () => [
          { unitId: 'u1', workAddress: 'Ruko A, Mojokerto' },
          { unitId: 'u2', workAddress: null },
        ]),
      },
      serviceOrderUnit: {
        findMany: jest.fn(async () => [
          { id: 'r1', unitId: 'u1', unit: { id: 'u1' } },
          { id: 'r2', unitId: 'u2', unit: { id: 'u2' } },
        ]),
      },
    };
    const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    const r = await svc.unitLabels('j1', 't1', 'teknisi');
    expect(r.serviceOrderUnits).toEqual([
      { id: 'r1', unit: { id: 'u1' }, workAddress: 'Ruko A, Mojokerto' },
      { id: 'r2', unit: { id: 'u2' }, workAddress: null },
    ]);
    expect(r.member).toMatchObject({ address: 'Jl. Melati' });
    expect(prisma.technicianJob.findMany.mock.calls[0][0].where).toEqual({ orderId: 'o1', status: { not: 'dibatalkan' } });
  });
});

describe('AcUnitLabelsService.labelData — alamat kerja dari job yang sedang berjalan', () => {
  it('menambahkan workAddress per unit dari job aktif; unit tanpa job aktif/tanpa titik kerja = null', async () => {
    const member = { id: 'm1', name: 'Bu Sari', phone: null, address: 'Jl. Melati' };
    const prisma: any = {
      memberAcUnit: {
        findMany: jest.fn(async () => [
          { id: 'u1', barcodeValue: 'B1', status: 'aktif', member, pk: null },
          { id: 'u2', barcodeValue: 'B2', status: 'aktif', member, pk: null },
          { id: 'u3', barcodeValue: 'B3', status: 'aktif', member, pk: null },
        ]),
      },
      technicianJobAssignee: ownerAssignee,
      technicianJob: {
        findMany: jest.fn(async () => [
          { unitId: 'u1', workAddress: 'Ruko A, Mojokerto' }, // terbaru
          { unitId: 'u1', workAddress: 'Lama' }, // lebih lama: diabaikan
          { unitId: 'u2', workAddress: null }, // job aktif tanpa titik kerja
        ]),
      },
    };
    const svc = new AcUnitLabelsService(prisma);
    const r = await svc.labelData(['u1', 'u2', 'u3']);
    expect(r.map((x) => [x.id, x.workAddress])).toEqual([
      ['u1', 'Ruko A, Mojokerto'],
      ['u2', null],
      ['u3', null],
    ]);
    expect(r[0].member.address).toBe('Jl. Melati');
    const where = prisma.technicianJob.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ unitId: { in: ['u1', 'u2', 'u3'] }, status: { notIn: ['selesai', 'dibatalkan'] } });
    expect(prisma.technicianJob.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });
});
