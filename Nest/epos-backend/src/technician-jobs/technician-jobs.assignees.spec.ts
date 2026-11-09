import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';
import {
  assertValidTechnicians,
  assignedTo,
  isJobAssignee,
  normalizeTechnicianIds,
  setJobAssignees,
} from './job-assignees';

// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Penugasan beberapa teknisi per job: helper tunggal untuk normalisasi id, validasi, penulisan assignees,
// dan pengecekan keanggotaan (dipakai semua guard akses job).

describe('normalizeTechnicianIds', () => {
  it('technicianId lama dianggap daftar berisi satu', () => {
    expect(normalizeTechnicianIds({ technicianId: 'a' })).toEqual(['a']);
  });

  it('technicianIds menang atas technicianId, duplikat dibuang, urutan dipertahankan', () => {
    expect(normalizeTechnicianIds({ technicianIds: ['a', 'b', 'a'], technicianId: 'z' })).toEqual(['a', 'b']);
  });

  it('tanpa apa pun, null, atau string kosong -> daftar kosong', () => {
    expect(normalizeTechnicianIds({})).toEqual([]);
    expect(normalizeTechnicianIds({ technicianId: null })).toEqual([]);
    expect(normalizeTechnicianIds({ technicianIds: ['', '  '] })).toEqual([]);
  });
});

describe('assertValidTechnicians', () => {
  const db = (users: { id: string; role: string; active: boolean }[]) => ({
    user: { findMany: jest.fn(async ({ where }: any) => users.filter((u) => where.id.in.includes(u.id))) },
  });
  const ok = (id: string) => ({ id, role: 'teknisi', active: true });

  it('daftar kosong lolos tanpa query', async () => {
    const d = db([]);
    await expect(assertValidTechnicians(d as any, [])).resolves.toBeUndefined();
    expect(d.user.findMany).not.toHaveBeenCalled();
  });

  it('semua teknisi aktif lolos', async () => {
    await expect(assertValidTechnicians(db([ok('a'), ok('b')]) as any, ['a', 'b'])).resolves.toBeUndefined();
  });

  it('lebih dari 5 teknisi ditolak', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    await expect(assertValidTechnicians(db(ids.map(ok)) as any, ids)).rejects.toThrow(
      new BadRequestException('Maksimal 5 teknisi per job'),
    );
  });

  it('id yang tidak ditemukan, user nonaktif, atau bukan teknisi ditolak', async () => {
    const msg = new BadRequestException('Teknisi tidak valid atau tidak aktif');
    await expect(assertValidTechnicians(db([ok('a')]) as any, ['a', 'x'])).rejects.toThrow(msg);
    await expect(
      assertValidTechnicians(db([ok('a'), { id: 'b', role: 'teknisi', active: false }]) as any, ['a', 'b']),
    ).rejects.toThrow(msg);
    await expect(
      assertValidTechnicians(db([ok('a'), { id: 'k', role: 'kasir', active: true }]) as any, ['a', 'k']),
    ).rejects.toThrow(msg);
  });
});

describe('setJobAssignees', () => {
  const tx = () => ({
    technicianJobAssignee: { deleteMany: jest.fn(async () => ({})), createMany: jest.fn(async () => ({})) },
    technicianJob: { update: jest.fn(async () => ({})) },
  });

  it('mengganti seluruh baris assignees dan menjadikan teknisi pertama sebagai technicianId', async () => {
    const t = tx();
    await setJobAssignees(t as any, 'j1', ['b', 'a']);
    expect(t.technicianJobAssignee.deleteMany).toHaveBeenCalledWith({ where: { jobId: 'j1' } });
    expect(t.technicianJobAssignee.createMany).toHaveBeenCalledWith({
      data: [
        { jobId: 'j1', technicianId: 'b' },
        { jobId: 'j1', technicianId: 'a' },
      ],
    });
    expect(t.technicianJob.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { technicianId: 'b' } });
  });

  it('daftar kosong menghapus semua assignees dan mengosongkan technicianId', async () => {
    const t = tx();
    await setJobAssignees(t as any, 'j1', []);
    expect(t.technicianJobAssignee.createMany).not.toHaveBeenCalled();
    expect(t.technicianJob.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { technicianId: null } });
  });
});

describe('isJobAssignee / assignedTo', () => {
  it('true bila ada baris assignees untuk pasangan job-user itu', async () => {
    const db = { technicianJobAssignee: { count: jest.fn(async () => 1) } };
    await expect(isJobAssignee(db as any, 'j1', 't2')).resolves.toBe(true);
    expect(db.technicianJobAssignee.count).toHaveBeenCalledWith({ where: { jobId: 'j1', technicianId: 't2' } });
  });

  it('false bila tidak ada barisnya', async () => {
    const db = { technicianJobAssignee: { count: jest.fn(async () => 0) } };
    await expect(isJobAssignee(db as any, 'j1', 't9')).resolves.toBe(false);
  });

  it('assignedTo membangun filter keanggotaan', () => {
    expect(assignedTo('t2')).toEqual({ assignees: { some: { technicianId: 't2' } } });
  });
});

// ---- Task 2: guard akses & query teknisi berbasis assignees ----

const tech = (id: string, displayName: string) => ({ technician: { id, displayName } });

function makeSvc(assigneeIds: string[] = ['t1', 't2']) {
  const tx: any = { jobFinding: { create: jest.fn(async () => ({ id: 'f1' })) } };
  const prisma: any = {
    technicianJob: {
      findUnique: jest.fn(),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      update: jest.fn(),
    },
    technicianJobAssignee: {
      count: jest.fn(async ({ where }: any) => (assigneeIds.includes(where.technicianId) ? 1 : 0)),
    },
    materialRequestItem: { groupBy: jest.fn(async () => []) },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
  };
  const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  jest.spyOn(svc as any, 'findOrCreateCategory').mockResolvedValue({ id: 'c1', name: 'Bocor' });
  return { svc, prisma, tx };
}

const activeJob = (extra: Record<string, unknown> = {}) => ({
  id: 'j1',
  orderId: 'o1',
  technicianId: 't1',
  status: 'assigned',
  startedAt: null,
  unit: null,
  ...extra,
});

describe('guard akses job berbasis assignees', () => {
  it('assignee kedua (bukan technicianId pertama) boleh menambah temuan', async () => {
    const { svc, prisma, tx } = makeSvc();
    prisma.technicianJob.findUnique.mockResolvedValue(activeJob());
    await expect(svc.addFinding('j1', { categoryName: 'Bocor' }, 't2', 'teknisi')).resolves.toBeDefined();
    expect(tx.jobFinding.create).toHaveBeenCalled();
  });

  it('teknisi yang BUKAN assignee ditolak 403 (temuan dan mulai job)', async () => {
    const { svc, prisma } = makeSvc();
    prisma.technicianJob.findUnique.mockResolvedValue(activeJob());
    const msg = new ForbiddenException('Job ini bukan milik Anda');
    await expect(svc.addFinding('j1', { categoryName: 'Bocor' }, 't9', 'teknisi')).rejects.toThrow(msg);
    await expect(svc.start('j1', 'BC', 't9', 'teknisi')).rejects.toThrow(msg);
  });

  it('admin selalu lolos tanpa cek assignees', async () => {
    const { svc, prisma } = makeSvc();
    prisma.technicianJob.findUnique.mockResolvedValue(activeJob());
    await expect(svc.addFinding('j1', { categoryName: 'Bocor' }, 'admin1', 'admin')).resolves.toBeDefined();
    expect(prisma.technicianJobAssignee.count).not.toHaveBeenCalled();
  });

  it('start oleh assignee ketika job sudah sedang_dikerjakan idempoten: kembalikan job apa adanya, tanpa update', async () => {
    const { svc, prisma } = makeSvc();
    const running = activeJob({ status: 'sedang_dikerjakan', startedAt: new Date() });
    prisma.technicianJob.findUnique.mockResolvedValue(running);
    await expect(svc.start('j1', 'BC', 't2', 'teknisi')).resolves.toBe(running);
    expect(prisma.technicianJob.update).not.toHaveBeenCalled();
  });

  it('findOne: non-assignee 403, assignee lolos dan saudara order dibatasi ke job miliknya', async () => {
    const { svc, prisma } = makeSvc();
    const job = activeJob({
      order: { type: 'perbaikan' },
      assignees: [tech('t1', 'Ani'), tech('t2', 'Budi')],
    });
    prisma.technicianJob.findUnique.mockResolvedValue(job);
    await expect(svc.findOne('j1', 't9', 'teknisi')).rejects.toThrow(ForbiddenException);
    await expect(svc.findOne('j1', 't2', 'teknisi')).resolves.toMatchObject({ id: 'j1' });
    expect(prisma.technicianJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'o1', id: { not: 'j1' }, assignees: { some: { technicianId: 't2' } } },
      }),
    );
  });
});

describe('query teknisi memakai assignees', () => {
  const mine = [{ id: 'j1', technicianId: 't1', assignees: [tech('t1', 'Ani'), tech('t2', 'Budi')] }];

  it('mine, myQueue, todayBundle, history memfilter lewat assignees.some', async () => {
    const { svc, prisma } = makeSvc();
    const f = { assignees: { some: { technicianId: 't2' } } };
    await svc.mine('t2');
    expect(prisma.technicianJob.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: f }));
    await svc.myQueue('t2');
    expect(prisma.technicianJob.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining(f) }),
    );
    await svc.todayBundle('t2');
    expect(prisma.technicianJob.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining(f) }),
    );
    await svc.history('t2', 1, 20);
    expect(prisma.technicianJob.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining(f) }),
    );
    expect(prisma.technicianJob.count).toHaveBeenLastCalledWith({ where: expect.objectContaining(f) });
  });

  it('respons job memuat technicianIds + technicians (urutan assignees) tanpa field mentah assignees', async () => {
    const { svc, prisma } = makeSvc();
    prisma.technicianJob.findMany.mockResolvedValue(mine);
    const [job] = await svc.mine('t2');
    expect(job).toMatchObject({
      technicianId: 't1',
      technicianIds: ['t1', 't2'],
      technicians: [
        { id: 't1', displayName: 'Ani' },
        { id: 't2', displayName: 'Budi' },
      ],
    });
    expect(job).not.toHaveProperty('assignees');
  });
});
