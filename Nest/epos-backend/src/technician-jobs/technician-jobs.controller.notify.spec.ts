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
