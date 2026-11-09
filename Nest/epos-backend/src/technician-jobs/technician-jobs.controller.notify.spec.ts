// Rantai impor controller menarik @nestjs/schedule (ESM) yang tidak bisa dimuat jest; tidak dipakai di sini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

import { TechnicianJobsController } from './technician-jobs.controller';

const admin: any = { sub: 'a1', role: 'admin' };

function setup(job: any) {
  const jobs: any = {
    sendBack: jest.fn(async () => job),
    cancel: jest.fn(async () => job),
  };
  const realtime: any = { emitToAdmin: jest.fn() };
  const notifications: any = { notify: jest.fn(async () => undefined) };
  const ctrl = new TechnicianJobsController(jobs, realtime, {} as any, notifications, {} as any);
  return { ctrl, notifications };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('TechnicianJobsController — kabari teknisi', () => {
  it('send-back: teknisi dapat notifikasi berisi catatan admin', async () => {
    const { ctrl, notifications } = setup({ id: 'j1', status: 'sedang_dikerjakan', technicianId: 't1' });
    await ctrl.sendBack('j1', { note: '  Foto sesudah kurang jelas  ' } as any, admin);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const [userId, params] = notifications.notify.mock.calls[0];
    expect(userId).toBe('t1');
    expect(params).toMatchObject({ type: 'job_returned', target: 'j1' });
    expect(params.body).toContain('Foto sesudah kurang jelas');
  });

  it('send-back: catatan panjang dipotong agar lonceng tetap ringkas', async () => {
    const { ctrl, notifications } = setup({ id: 'j1', status: 'sedang_dikerjakan', technicianId: 't1' });
    await ctrl.sendBack('j1', { note: 'x'.repeat(500) } as any, admin);
    expect(notifications.notify.mock.calls[0][1].body.length).toBeLessThan(180);
  });

  it('send-back: job tanpa teknisi -> tidak ada notifikasi', async () => {
    const { ctrl, notifications } = setup({ id: 'j1', status: 'sedang_dikerjakan', technicianId: null });
    await ctrl.sendBack('j1', { note: 'ulang' } as any, admin);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('cancel: teknisi dapat notifikasi job dibatalkan', async () => {
    const { ctrl, notifications } = setup({ id: 'j1', status: 'dibatalkan', technicianId: 't1' });
    await ctrl.cancel('j1', admin, {});
    expect(notifications.notify).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ type: 'job_cancelled', target: 'j1' }),
    );
  });

  it('cancel tetap berhasil walau notifikasi gagal', async () => {
    const { ctrl, notifications } = setup({ id: 'j1', status: 'dibatalkan', technicianId: 't1' });
    notifications.notify.mockRejectedValue(new Error('push down'));
    await expect(ctrl.cancel('j1', admin, {})).resolves.toMatchObject({ status: 'dibatalkan' });
    await flush();
  });
});

describe('TechnicianJobsController.assign — kabari teknisi yang masuk & keluar', () => {
  const run = async (assignResult: any, dto: any) => {
    const jobs: any = { assign: jest.fn(async () => assignResult) };
    const realtime: any = { emitToAdmin: jest.fn() };
    const notifications: any = { notify: jest.fn(async () => undefined) };
    const ctrl = new TechnicianJobsController(jobs, realtime, {} as any, notifications, {} as any);
    await ctrl.assign('j1', dto, { sub: 'a1', role: 'admin' } as any);
    return { jobs, notifications };
  };
  const calls = (n: any) => n.notify.mock.calls.map((c: any) => [c[0], c[1].type, c[1].title]);

  it('penugasan baru ke 2 teknisi: keduanya dapat "Job Baru Ditugaskan"; job_assigned, tidak ada yang keluar', async () => {
    const { jobs, notifications } = await run(
      { status: 'assigned', previousTechnicianIds: [], addedTechnicianIds: ['t1', 't2'] },
      { technicianIds: ['t1', 't2'] },
    );
    expect(jobs.assign).toHaveBeenCalledWith('j1', ['t1', 't2'], expect.objectContaining({ actorId: 'a1', role: 'admin' }));
    expect(calls(notifications)).toEqual([
      ['t1', 'job_assigned', 'Job Baru Ditugaskan'],
      ['t2', 'job_assigned', 'Job Baru Ditugaskan'],
    ]);
  });

  it('ada yang diganti: yang masuk dapat "Dialihkan ke Kamu", yang keluar dapat job_handover, yang tetap tidak dikabari ulang', async () => {
    const { notifications } = await run(
      { status: 'assigned', previousTechnicianIds: ['t2'], addedTechnicianIds: ['t3'] },
      { technicianIds: ['t1', 't3'] },
    );
    expect(calls(notifications)).toEqual([
      ['t3', 'job_assigned', 'Job Dialihkan ke Kamu'],
      ['t2', 'job_handover', 'Job Dialihkan'],
    ]);
  });

  it('bentuk lama technicianId tunggal tetap diterima (APK lama)', async () => {
    const { jobs } = await run({ status: 'assigned', previousTechnicianIds: [], addedTechnicianIds: ['t9'] }, { technicianId: 't9' });
    expect(jobs.assign).toHaveBeenCalledWith('j1', ['t9'], expect.anything());
  });
});
