import { RemindersService, SERVICE_DUE_NOTIFICATION } from './reminders.service';
import { wibDayRange } from '../common/wib-date.util';

// @nestjs/schedule ESM-only; @Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Notifikasi bel ke ADMIN saat unit pelanggan jatuh tempo servis cuci (H-3), satu per pelanggan.
const NOW = new Date('2026-11-05T03:00:00Z'); // 10:00 WIB
const DUE = new Date('2026-11-08T00:00:00Z'); // H-3

const unit = (memberId: string, name: string) => ({ memberId, nextServiceDate: DUE, member: { name } });

function setup(opts: { units?: unknown[]; admins?: { id: string }[]; already?: (where: any) => boolean } = {}) {
  const prisma: any = {
    memberAcUnit: { findMany: jest.fn(async () => opts.units ?? []) },
    user: { findMany: jest.fn(async () => opts.admins ?? [{ id: 'a1' }]) },
    notification: { findFirst: jest.fn(async ({ where }: any) => (opts.already?.(where) ? { id: 'n-lama' } : null)) },
  };
  const notifications: any = { notify: jest.fn(async () => ({})) };
  const svc = new RemindersService(prisma, {} as any, notifications);
  return { svc, prisma, notifications };
}

describe('RemindersService.notifyAdminsServiceDue', () => {
  it('satu notifikasi per pelanggan per admin, berisi jumlah unit dan tanggal jatuh tempo', async () => {
    const { svc, notifications } = setup({
      units: [unit('m1', 'RSU Dummy'), unit('m1', 'RSU Dummy'), unit('m1', 'RSU Dummy'), unit('m2', 'Bu Sari')],
      admins: [{ id: 'a1' }, { id: 'a2' }],
    });
    const n = await svc.notifyAdminsServiceDue(NOW);

    expect(n).toBe(4); // 2 pelanggan x 2 admin
    expect(notifications.notify).toHaveBeenCalledTimes(4);
    const forM1 = notifications.notify.mock.calls.filter((c: any) => c[1].target === 'm1');
    expect(forM1).toHaveLength(2);
    expect(forM1[0][1]).toMatchObject({
      title: 'Servis AC jatuh tempo: RSU Dummy',
      type: SERVICE_DUE_NOTIFICATION,
      target: 'm1',
    });
    expect(forM1[0][1].body).toContain('3 unit AC jatuh tempo');
    expect(forM1[0][1].body).toContain('8 November 2026');
    expect(forM1[0][1].body).toContain('Buat job servis cuci AC');
    expect(notifications.notify.mock.calls.map((c: any) => c[0]).sort()).toEqual(['a1', 'a1', 'a2', 'a2']);
  });

  it('hanya unit aktif, pengingat menyala, H-3, pelanggan aktif, tanpa job berjalan; opt-out WA TIDAK menyaring', async () => {
    const { svc, prisma } = setup({ units: [unit('m1', 'A')] });
    await svc.notifyAdminsServiceDue(NOW);
    const where = prisma.memberAcUnit.findMany.mock.calls[0][0].where;
    const h3 = wibDayRange(new Date(NOW.getTime() + 3 * 86400000));
    expect(where).toMatchObject({ status: 'aktif', reminderEnabled: true, member: { active: true } });
    expect(where.member).not.toHaveProperty('waOptOut'); // admin tetap perlu tahu pelanggan yang opt-out WA
    expect(where.nextServiceDate).toEqual({ gte: h3.start, lte: h3.end });
    expect(where.technicianJobs.none.status.notIn).toEqual(['selesai', 'dibatalkan']);
  });

  it('tidak mengirim ulang ke admin yang sudah menerimanya hari ini (aman untuk run-now berkali-kali)', async () => {
    const { svc, notifications, prisma } = setup({
      units: [unit('m1', 'A'), unit('m2', 'B')],
      admins: [{ id: 'a1' }, { id: 'a2' }],
      already: (w) => w.userId === 'a1' && w.target === 'm1',
    });
    const n = await svc.notifyAdminsServiceDue(NOW);
    expect(n).toBe(3);
    expect(notifications.notify).not.toHaveBeenCalledWith('a1', expect.objectContaining({ target: 'm1' }));
    const w = prisma.notification.findFirst.mock.calls[0][0].where;
    expect(w).toMatchObject({ type: SERVICE_DUE_NOTIFICATION });
    expect(w.createdAt.gte).toEqual(wibDayRange(NOW).start); // pembatas: awal hari ini (WIB)
  });

  it('tanpa unit jatuh tempo atau tanpa admin aktif: tidak ada notifikasi', async () => {
    const kosong = setup({ units: [] });
    expect(await kosong.svc.notifyAdminsServiceDue(NOW)).toBe(0);
    expect(kosong.prisma.user.findMany).not.toHaveBeenCalled();

    const tanpaAdmin = setup({ units: [unit('m1', 'A')], admins: [] });
    expect(await tanpaAdmin.svc.notifyAdminsServiceDue(NOW)).toBe(0);
    expect(tanpaAdmin.notifications.notify).not.toHaveBeenCalled();
  });
});

describe('RemindersService.runDailyEnqueue — notifikasi admin', () => {
  it('hasilnya memuat adminNotified', async () => {
    const { svc, prisma } = setup();
    // panggilan pertama = antrean WA (tidak ada unit), kedua = notifikasi admin
    prisma.memberAcUnit.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([unit('m1', 'A')]);
    const res = await svc.runDailyEnqueue();
    expect(res).toEqual({ enqueued: 0, sent: 0, failed: 0, adminNotified: 1 });
  });

  it('notifikasi admin yang gagal tidak menjatuhkan pengingat WA', async () => {
    const { svc, prisma } = setup();
    prisma.memberAcUnit.findMany.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('db putus'));
    await expect(svc.runDailyEnqueue()).resolves.toEqual({ enqueued: 0, sent: 0, failed: 0, adminNotified: 0 });
  });
});
