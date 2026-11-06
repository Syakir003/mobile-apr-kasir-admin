import { TechnicianJobsService, KIRIM_WA_SELESAI_SERVIS } from './technician-jobs.service';

// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));
jest.mock('./unit-maintenance.util', () => ({ releaseUnitMaintenanceTx: jest.fn(async () => undefined) }));

// WA "pekerjaan selesai" saat job disetujui dinonaktifkan: pelanggan cukup menerima nota dari admin. Siklus servis unit tetap diisi.
describe('approveComplete — WA selesai servis dinonaktifkan', () => {
  it('saklar KIRIM_WA_SELESAI_SERVIS mati', () => {
    expect(KIRIM_WA_SELESAI_SERVIS).toBe(false);
  });

  it('job cuci disetujui dengan pengingat nyala: siklus unit tetap diisi, tetapi tidak ada WA yang diantre/dikirim', async () => {
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      technicianJob: { update: jest.fn(async () => ({ id: 'j1', status: 'selesai' })), count: jest.fn(async () => 0) },
      serviceOrderUnit: { updateMany: jest.fn(async () => ({})) },
      memberAcUnit: { update: jest.fn(async () => ({ memberId: 'm1' })) },
      serviceOrder: { update: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      technicianJob: {
        findUnique: jest.fn(async () => ({
          id: 'j1', orderId: 'o1', unitId: 'u1', memberId: 'm1', type: 'cuci', status: 'menunggu_review', billingDerived: true, complaintOfJobId: null,
        })),
      },
      memberAcUnit: { findUnique: jest.fn(async () => ({ serviceIntervalDays: null })) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const reminders: any = { enqueueJobCompleteMessageTx: jest.fn(), cancelPendingForUnitTx: jest.fn() };
    const whatsapp: any = { sendPendingLog: jest.fn() };
    const svc = new TechnicianJobsService(prisma, reminders, whatsapp, {} as any, {} as any, {} as any);
    jest.spyOn(svc as any, 'assertJobPriced').mockResolvedValue(undefined);

    await svc.approveComplete('j1', 'admin', { reminderEnabled: true, serviceIntervalDays: 90 });

    expect(tx.memberAcUnit.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.objectContaining({ reminderEnabled: true, serviceIntervalDays: 90, nextServiceDate: expect.any(Date) }),
    });
    expect(reminders.enqueueJobCompleteMessageTx).not.toHaveBeenCalled();
    expect(whatsapp.sendPendingLog).not.toHaveBeenCalled();
  });
});
