import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';

/**
 * addJobPhoto() — port dari RPC Postgres `add_job_photo` (model lama
 * level-job, tanpa temuan), ditambahkan sesi migrasi Flutter->Nest karena
 * app mobile belum punya UI temuan sama sekali. Guard-nya WAJIB sama persis
 * dengan addFindingPhoto()/RPC lama: pemilik job atau admin, status job
 * aktif (assigned/sedang_dikerjakan), kind sebelum/sesudah — dites di sini
 * lepas dari HTTP/multer (constructor Prisma di-mock manual, pola sama
 * seperti members.service.spec.ts).
 */
describe('TechnicianJobsService.addJobPhoto', () => {
  function makeService(job: { technicianId: string | null; status: string } | null) {
    const created: any[] = [];
    const prisma = {
      technicianJob: {
        findUnique: jest.fn().mockResolvedValue(job),
      },
      jobPhoto: {
        create: jest.fn((args: any) => {
          created.push(args.data);
          return Promise.resolve({ id: 'photo-1', ...args.data });
        }),
      },
    };
    const service = new TechnicianJobsService(prisma as any, {} as any);
    return { service, prisma, created };
  }

  it('kind di luar sebelum/sesudah ditolak SEBELUM query job (validasi paling murah duluan)', async () => {
    const { service, prisma } = makeService(null);
    await expect(
      service.addJobPhoto('job-1', 'lainnya' as any, '/uploads/job-photos/x.jpg', 'teknisi-1', 'teknisi'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.technicianJob.findUnique).not.toHaveBeenCalled();
  });

  it('job tidak ditemukan -> NotFoundException', async () => {
    const { service } = makeService(null);
    await expect(
      service.addJobPhoto('job-tak-ada', 'sebelum', '/uploads/job-photos/x.jpg', 'teknisi-1', 'teknisi'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('teknisi bukan pemilik job -> ForbiddenException (cegah IDOR lihat/unggah foto job orang lain)', async () => {
    const { service } = makeService({ technicianId: 'teknisi-lain', status: 'assigned' });
    await expect(
      service.addJobPhoto('job-1', 'sebelum', '/uploads/job-photos/x.jpg', 'teknisi-1', 'teknisi'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('job berstatus selesai -> ditolak (foto cuma boleh saat job aktif)', async () => {
    const { service } = makeService({ technicianId: 'teknisi-1', status: 'selesai' });
    await expect(
      service.addJobPhoto('job-1', 'sebelum', '/uploads/job-photos/x.jpg', 'teknisi-1', 'teknisi'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('admin boleh unggah foto ke job siapa pun yang statusnya aktif', async () => {
    const { service, created } = makeService({ technicianId: 'teknisi-lain', status: 'sedang_dikerjakan' });
    const photo = await service.addJobPhoto(
      'job-1',
      'sesudah',
      '/uploads/job-photos/abc.jpg',
      'admin-1',
      'admin',
    );
    expect(photo.id).toBe('photo-1');
    expect(created).toEqual([
      { jobId: 'job-1', kind: 'sesudah', path: '/uploads/job-photos/abc.jpg', uploadedById: 'admin-1' },
    ]);
  });

  it('teknisi pemilik job berstatus assigned boleh unggah foto sebelum', async () => {
    const { service, created } = makeService({ technicianId: 'teknisi-1', status: 'assigned' });
    await service.addJobPhoto('job-1', 'sebelum', '/uploads/job-photos/x.jpg', 'teknisi-1', 'teknisi');
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('sebelum');
  });
});

/**
 * findAll(unitId) — endpoint baru sesi migrasi Flutter->Nest (dipakai
 * [unitJobHistoryProvider] mobile). RBAC-nya port dari RLS
 * `my_visible_job_ids()` (migrasi 20260806000020): admin/kasir bebas, teknisi
 * WAJIB isi unitId dan cuma kebagian hasil kalau punya job SENDIRI di unit
 * itu (all-or-nothing per unit, bukan per baris job).
 */
describe('TechnicianJobsService.findAll — RBAC unitId', () => {
  function makeService(ownJobOnUnitCount: number) {
    const prisma = {
      technicianJob: {
        count: jest.fn().mockResolvedValue(ownJobOnUnitCount),
        findMany: jest.fn().mockResolvedValue([{ id: 'job-1' }]),
      },
    };
    const service = new TechnicianJobsService(prisma as any, {} as any);
    return { service, prisma };
  }

  it('teknisi tanpa unitId -> ForbiddenException (gak boleh list semua job)', async () => {
    const { service } = makeService(0);
    await expect(
      service.findAll(undefined, undefined, { sub: 'teknisi-1', role: 'teknisi' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('teknisi isi unitId tapi gak punya job sendiri di unit itu -> array kosong, tak nge-query findMany', async () => {
    const { service, prisma } = makeService(0);
    const result = await service.findAll(undefined, 'unit-lain', {
      sub: 'teknisi-1',
      role: 'teknisi',
    });
    expect(result).toEqual([]);
    expect(prisma.technicianJob.findMany).not.toHaveBeenCalled();
  });

  it('teknisi isi unitId dan punya job sendiri di unit itu -> lolos, kebagian SEMUA job unit itu (termasuk milik teknisi lain)', async () => {
    const { service, prisma } = makeService(1);
    const result = await service.findAll(undefined, 'unit-1', {
      sub: 'teknisi-1',
      role: 'teknisi',
    });
    expect(result).toEqual([{ id: 'job-1' }]);
    expect(prisma.technicianJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { unitId: 'unit-1' } }),
    );
  });

  it('admin tanpa unitId -> list semua job, tanpa cek kepemilikan', async () => {
    const { service, prisma } = makeService(0);
    await service.findAll(undefined, undefined, { sub: 'admin-1', role: 'admin' });
    expect(prisma.technicianJob.count).not.toHaveBeenCalled();
    expect(prisma.technicianJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

/**
 * historyExtras() — endpoint bulk baru (layar riwayat servis per unit di
 * mobile, [unitHistoryProvider]). RBAC di-port dari RLS `job_photos`/
 * `material_requests` teknisi (migrasi 20260806000020): foto job VISIBLE
 * (miliknya + job lain di unit yang sama), material job MILIKNYA saja.
 */
describe('TechnicianJobsService.historyExtras — RBAC', () => {
  it('admin: semua job dihitung tanpa batasan', async () => {
    const prisma = {
      jobPhoto: {
        groupBy: jest.fn().mockResolvedValue([
          { jobId: 'job-1', kind: 'sebelum', _count: { _all: 2 } },
          { jobId: 'job-2', kind: 'sesudah', _count: { _all: 1 } },
        ]),
      },
      materialRequest: {
        groupBy: jest.fn().mockResolvedValue([
          { jobId: 'job-1', status: 'approved', _count: { _all: 1 }, _sum: { total: 50000 } },
          { jobId: 'job-2', status: 'pending', _count: { _all: 1 }, _sum: { total: null } },
        ]),
      },
    };
    const service = new TechnicianJobsService(prisma as any, {} as any);
    const result = await service.historyExtras(['job-1', 'job-2'], { sub: 'admin-1', role: 'admin' });

    expect(prisma.jobPhoto.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: { in: ['job-1', 'job-2'] } } }),
    );
    expect(result['job-1']).toEqual({
      photosBefore: 2,
      photosAfter: 0,
      materialItems: 1,
      materialTotal: 50000,
      materialPending: 0,
    });
    expect(result['job-2']).toEqual({
      photosBefore: 0,
      photosAfter: 1,
      materialItems: 0,
      materialTotal: 0,
      materialPending: 1,
    });
  });

  it('teknisi: foto job tetangga (unit sama) tetap dihitung, material job tetangga TIDAK', async () => {
    // job-mine milik teknisi-1 di unit-A; job-neighbor milik teknisi-lain
    // tapi juga di unit-A (job sebelumnya pada unit yang sama).
    const prisma = {
      technicianJob: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'job-mine', unitId: 'unit-A' }]) // query "job milik saya"
          .mockResolvedValueOnce([{ id: 'job-neighbor', unitId: 'unit-A' }]), // query kandidat lain
      },
      jobPhoto: {
        groupBy: jest.fn().mockResolvedValue([
          { jobId: 'job-mine', kind: 'sebelum', _count: { _all: 1 } },
          { jobId: 'job-neighbor', kind: 'sebelum', _count: { _all: 3 } },
        ]),
      },
      materialRequest: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ jobId: 'job-mine', status: 'approved', _count: { _all: 1 }, _sum: { total: 20000 } }]),
      },
    };
    const service = new TechnicianJobsService(prisma as any, {} as any);
    const result = await service.historyExtras(['job-mine', 'job-neighbor'], {
      sub: 'teknisi-1',
      role: 'teknisi',
    });

    // Foto: kedua job dihitung (job-neighbor VISIBLE karena satu unit dengan job-mine).
    expect(prisma.jobPhoto.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: { in: expect.arrayContaining(['job-mine', 'job-neighbor']) } } }),
    );
    // Material: HANYA job-mine yang di-query (job-neighbor bukan milik teknisi-1).
    expect(prisma.materialRequest.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: { in: ['job-mine'] } } }),
    );
    expect(result['job-neighbor']).toEqual({
      photosBefore: 3,
      photosAfter: 0,
      materialItems: 0,
      materialTotal: 0,
      materialPending: 0,
    });
    expect(result['job-mine'].materialItems).toBe(1);
  });

  it('jobIds kosong -> object kosong, tak nge-query DB sama sekali', async () => {
    const prisma = {
      jobPhoto: { groupBy: jest.fn() },
      materialRequest: { groupBy: jest.fn() },
    };
    const service = new TechnicianJobsService(prisma as any, {} as any);
    const result = await service.historyExtras([], { sub: 'admin-1', role: 'admin' });
    expect(result).toEqual({});
    expect(prisma.jobPhoto.groupBy).not.toHaveBeenCalled();
  });
});
