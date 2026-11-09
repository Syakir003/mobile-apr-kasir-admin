// Rantai impor controller menarik @nestjs/schedule (ESM) yang tidak bisa dimuat jest; tidak dipakai di sini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

import { TechnicianJobsController } from './technician-jobs.controller';
import { TechnicianJobsService } from './technician-jobs.service';

// Beban kerja teknisi untuk peringatan "sedang mengerjakan job lain" saat admin/kasir menugaskan: hanya job
// `sedang_dikerjakan`, hanya teknisi aktif, tanpa data harga/tagihan.

const t = (id: string, active = true, role = 'teknisi') => ({ technician: { id, active, role } });
const jobRow = (id: string, assignees: ReturnType<typeof t>[], extra: Record<string, unknown> = {}) => ({
  id,
  workAddress: null,
  member: { name: 'Bu Sari' },
  unit: { roomLocation: 'Kamar Utama' },
  assignees,
  ...extra,
});

function setup(rows: unknown[]) {
  const prisma: any = { technicianJob: { findMany: jest.fn(async () => rows) } };
  const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, prisma };
}

describe('TechnicianJobsService.workload', () => {
  it('hanya job sedang_dikerjakan yang diambil', async () => {
    const { svc, prisma } = setup([]);
    await svc.workload();
    expect(prisma.technicianJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'sedang_dikerjakan' } }),
    );
  });

  it('satu job dengan 2 assignee: kedua teknisi sibuk dengan job yang sama', async () => {
    const { svc } = setup([jobRow('j1', [t('t1'), t('t2')])]);
    const res = await svc.workload();
    expect(res).toEqual([
      { technicianId: 't1', jobs: [{ jobId: 'j1', customerName: 'Bu Sari', location: 'Kamar Utama' }] },
      { technicianId: 't2', jobs: [{ jobId: 'j1', customerName: 'Bu Sari', location: 'Kamar Utama' }] },
    ]);
  });

  it('teknisi nonaktif atau bukan role teknisi tidak ikut', async () => {
    const { svc } = setup([jobRow('j1', [t('t1'), t('t2', false), t('k1', true, 'kasir')])]);
    expect((await svc.workload()).map((r) => r.technicianId)).toEqual(['t1']);
  });

  it('lokasi = titik lokasi kerja job bila ada, kalau tidak ruangan unit, kalau tidak null', async () => {
    const { svc } = setup([
      jobRow('j1', [t('t1')], { workAddress: 'Ruko A, Mojokerto' }),
      jobRow('j2', [t('t1')], { unit: { roomLocation: null } }),
      jobRow('j3', [t('t1')], { unit: null, member: null }),
    ]);
    const [row] = await svc.workload();
    expect(row.jobs.map((j) => j.location)).toEqual(['Ruko A, Mojokerto', null, null]);
    expect(row.jobs[2].customerName).toBeNull();
  });

  it('hasil tidak memuat field lain (tanpa harga/tagihan/telepon)', async () => {
    const { svc } = setup([jobRow('j1', [t('t1')], { invoice: 1, member: { name: 'A', phone: '08' } })]);
    const [row] = await svc.workload();
    expect(Object.keys(row)).toEqual(['technicianId', 'jobs']);
    expect(Object.keys(row.jobs[0])).toEqual(['jobId', 'customerName', 'location']);
  });
});

describe('TechnicianJobsController.workload', () => {
  it('hanya admin dan kasir (teknisi tidak boleh melihat beban kerja teknisi lain)', () => {
    expect(Reflect.getMetadata('roles', TechnicianJobsController.prototype.workload)).toEqual(['admin', 'kasir']);
  });

  it('terdaftar SEBELUM :id supaya "workload" tidak dikira id job', () => {
    const names = Object.getOwnPropertyNames(TechnicianJobsController.prototype);
    expect(names.indexOf('workload')).toBeGreaterThan(-1);
    expect(names.indexOf('workload')).toBeLessThan(names.indexOf('findOne'));
  });
});
