import { TechnicianJobsController } from './technician-jobs.controller';

// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

function make() {
  const pricing: any = {
    getFor: jest.fn(async () => ({ jobId: 'j1' })),
    techEditLines: jest.fn(async () => ({
      ok: true, jobId: 'j1', reason: 'Unit ketiga ikut dicuci', subtotalBefore: 150000, subtotalAfter: 225000,
      actorName: 'Budi', customerName: 'Bu Sari',
    })),
  };
  const realtime: any = { emitToAdmin: jest.fn() };
  const notifications: any = { notifyRoles: jest.fn(async () => undefined) };
  const ctrl = new TechnicianJobsController({} as any, realtime, {} as any, notifications, pricing);
  return { ctrl, pricing, realtime, notifications };
}

describe('TechnicianJobsController — harga jasa untuk teknisi', () => {
  it('GET service-pricing meneruskan peminta (teknisi dicek assignee di service)', async () => {
    const { ctrl, pricing } = make();
    await expect(ctrl.getServicePricing('j1', { sub: 't1', role: 'teknisi' } as any)).resolves.toEqual({ jobId: 'j1' });
    expect(pricing.getFor).toHaveBeenCalledWith('j1', 't1', 'teknisi');
  });

  it('PATCH service-lines: panggil service, kabari admin lewat realtime dan admin+kasir lewat notifikasi', async () => {
    const { ctrl, pricing, realtime, notifications } = make();
    const dto: any = { lines: [{ id: 'l1', qty: 3 }], reason: 'Unit ketiga ikut dicuci' };
    const r = await ctrl.techEditServiceLines('j1', dto, { sub: 't1', role: 'teknisi' } as any);
    expect(pricing.techEditLines).toHaveBeenCalledWith('j1', dto, 't1');
    expect(realtime.emitToAdmin).toHaveBeenCalledWith('job.price_edited', { jobId: 'j1' });
    const [roles, payload] = notifications.notifyRoles.mock.calls[0];
    expect(roles).toEqual(['admin', 'kasir']);
    expect(payload).toMatchObject({ type: 'job_price_edited', target: 'j1', title: 'Jasa Disesuaikan Teknisi' });
    expect(payload.body).toContain('Budi');
    expect(payload.body).toContain('Bu Sari');
    expect(payload.body).toContain('Unit ketiga ikut dicuci');
    expect(r).toMatchObject({ ok: true, subtotalAfter: 225000 });
  });
});
