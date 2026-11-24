// Rantai impor controller menarik @nestjs/schedule (ESM) yang tidak bisa dimuat jest; tidak dipakai di sini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

import { TechnicianJobsService } from './technician-jobs.service';

// GET /technician-jobs menambah `fieldComplete` (progres realtime Performa Teknisi): hanya job sedang_dikerjakan yang
// dicek, true bila minimal 1 temuan dan semua temuan punya foto sebelum + sesudah.

const job = (id: string, status: string) => ({
  id,
  status,
  technicianId: null,
  assignees: [],
});
const finding = (jobId: string, kinds: string[]) => ({
  jobId,
  photos: kinds.map((kind) => ({ kind })),
});

function setup(jobs: unknown[], findings: unknown[] = []) {
  const prisma: any = {
    technicianJob: { findMany: jest.fn(async () => jobs) },
    jobFinding: { findMany: jest.fn(async () => findings) },
  };
  const svc = new TechnicianJobsService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, prisma };
}

describe('TechnicianJobsService.findAll — fieldComplete', () => {
  it('tanpa job sedang dikerjakan: tidak ada query temuan, semua false', async () => {
    const { svc, prisma } = setup([
      job('a', 'assigned'),
      job('b', 'menunggu_review'),
      job('c', 'selesai'),
    ]);
    const res = await svc.findAll();
    expect(prisma.jobFinding.findMany).not.toHaveBeenCalled();
    expect(res.map((j) => j.fieldComplete)).toEqual([false, false, false]);
  });

  it('sedang dikerjakan: true hanya yang semua temuannya punya foto sebelum + sesudah', async () => {
    const { svc, prisma } = setup(
      [
        job('lengkap', 'sedang_dikerjakan'),
        job('kurang', 'sedang_dikerjakan'),
        job('kosong', 'sedang_dikerjakan'),
      ],
      [
        finding('lengkap', ['sebelum', 'sesudah']),
        finding('kurang', ['sebelum', 'sesudah']),
        finding('kurang', ['sebelum']),
      ],
    );
    const res = await svc.findAll();
    expect(Object.fromEntries(res.map((j) => [j.id, j.fieldComplete]))).toEqual(
      {
        lengkap: true,
        kurang: false,
        kosong: false,
      },
    );
    // satu query untuk semua job sedang dikerjakan, hanya id mereka
    expect(prisma.jobFinding.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.jobFinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: { in: ['lengkap', 'kurang', 'kosong'] } },
      }),
    );
  });

  it('job bukan sedang dikerjakan tidak ikut dicek walau punya temuan lengkap', async () => {
    const { svc, prisma } = setup(
      [job('x', 'assigned'), job('y', 'sedang_dikerjakan')],
      [finding('y', ['sebelum', 'sesudah'])],
    );
    const res = await svc.findAll();
    expect(prisma.jobFinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: { in: ['y'] } } }),
    );
    expect(Object.fromEntries(res.map((j) => [j.id, j.fieldComplete]))).toEqual(
      { x: false, y: true },
    );
  });
});
