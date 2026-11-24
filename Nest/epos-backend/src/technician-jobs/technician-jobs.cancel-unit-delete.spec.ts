import { TechnicianJobsService } from './technician-jobs.service';

// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Membatalkan job menghapus otomatis unit "QR dulu" yang baru dibuat untuk job itu dan belum terisi/discan, supaya data
// tidak menumpuk jadi sampah. Unit lain (lama, sudah terisi, sudah discan, atau punya job lain) dibiarkan.

const NOW = new Date('2026-11-24T10:00:00Z');

function setup(
  over: {
    unit?: Record<string, unknown> | null;
    otherJobs?: number;
    otherOrders?: number;
  } = {},
) {
  const job = {
    id: 'j1',
    orderId: 'o1',
    unitId: 'u1',
    type: 'cuci',
    status: 'assigned',
    billingDerived: false,
    transportLevel: 0,
    transportMode: 'dibagi',
    createdAt: NOW,
  };
  const unit =
    over.unit === null
      ? null
      : {
          id: 'u1',
          memberId: 'm1',
          barcodeValue: 'ACUNIT-1',
          brand: null,
          model: null,
          status: 'menunggu_data',
          labelAttachedAt: null,
          createdAt: NOW, // dibuat satu transaksi dengan job
          ...over.unit,
        };
  const tx: any = {
    technicianJob: {
      update: jest.fn(async ({ data }: any) => ({ ...job, ...data })),
      // release maintenance menghitung job lain yang TERBUKA (where.status ada); pemeriksaan hapus otomatis menghitung semua job lain.
      count: jest.fn(async ({ where }: any) => (where.status ? 0 : (over.otherJobs ?? 0))),
    },
    serviceOrderUnit: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn(async () => over.otherOrders ?? 0),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    memberAcUnit: {
      updateMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => unit),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    acUnitCorrection: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    member: { updateMany: jest.fn(async () => ({ count: 1 })) },
    jobServiceLine: { count: jest.fn(async () => 0) },
    materialRequest: { updateMany: jest.fn(async () => ({ count: 0 })), findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = {
    technicianJobAssignee: { count: jest.fn(async () => 1) },
    technicianJob: { findUnique: jest.fn(async () => job) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, tx };
}

describe('TechnicianJobsService.cancel — hapus otomatis unit "QR dulu" yang belum terisi', () => {
  it('unit baru dibuat bersama job, tipe kosong, belum discan, job ini satu-satunya: unit ikut terhapus', async () => {
    const { svc, tx } = setup();
    const res: any = await svc.cancel('j1', 'a1', 'admin');
    expect(res.deletedUnitCount).toBe(1);
    expect(res.status).toBe('dibatalkan');
    expect(tx.serviceOrderUnit.deleteMany).toHaveBeenCalledWith({ where: { unitId: { in: ['u1'] } } });
    expect(tx.memberAcUnit.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['u1'] } } });
    expect(tx.member.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', totalAcUnits: { gte: 1 } },
      data: { totalAcUnits: { decrement: 1 } },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'ac_unit.delete',
      target: 'u1',
      detail: { reason: 'job_dibatalkan', barcodeValue: 'ACUNIT-1', jobId: 'j1', orderId: 'o1' },
    });
  });

  it('QR sudah pernah discan (label sudah tertempel): unit dipertahankan', async () => {
    const { svc, tx } = setup({ unit: { labelAttachedAt: new Date('2026-11-24T10:30:00Z') } });
    const res: any = await svc.cancel('j1', 'a1', 'admin');
    expect(res.deletedUnitCount).toBe(0);
    expect(tx.memberAcUnit.deleteMany).not.toHaveBeenCalled();
  });

  it('tipe AC sudah terisi (status aktif): unit dipertahankan', async () => {
    const { svc, tx } = setup({ unit: { status: 'aktif', brand: 'Daikin' } });
    const res: any = await svc.cancel('j1', 'a1', 'admin');
    expect(res.deletedUnitCount).toBe(0);
    expect(tx.memberAcUnit.deleteMany).not.toHaveBeenCalled();
  });

  it('unit lama (dibuat jauh sebelum job, mis. Input Data Lampau yang labelnya mungkin sudah menempel): dipertahankan', async () => {
    const { svc, tx } = setup({ unit: { createdAt: new Date('2026-11-10T08:00:00Z') } });
    const res: any = await svc.cancel('j1', 'a1', 'admin');
    expect(res.deletedUnitCount).toBe(0);
    expect(tx.memberAcUnit.deleteMany).not.toHaveBeenCalled();
  });

  it('unit punya job lain atau ada di order lain: dipertahankan', async () => {
    const lain = setup({ otherJobs: 1 });
    expect(((await lain.svc.cancel('j1', 'a1', 'admin')) as any).deletedUnitCount).toBe(0);
    expect(lain.tx.memberAcUnit.deleteMany).not.toHaveBeenCalled();

    const order = setup({ otherOrders: 1 });
    expect(((await order.svc.cancel('j1', 'a1', 'admin')) as any).deletedUnitCount).toBe(0);
    expect(order.tx.memberAcUnit.deleteMany).not.toHaveBeenCalled();
  });

  it('job tanpa unit (slot) atau unit tidak ditemukan: tidak ada yang dihapus, pembatalan tetap berhasil', async () => {
    const hilang = setup({ unit: null });
    const res: any = await hilang.svc.cancel('j1', 'a1', 'admin');
    expect(res.status).toBe('dibatalkan');
    expect(res.deletedUnitCount).toBe(0);
  });

  it('batalkan semua unit: jumlah unit yang terhapus dijumlahkan dan dicatat di audit order', async () => {
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      technicianJob: { findMany: jest.fn(async () => [{ id: 'j1', assignees: [] }, { id: 'j2', assignees: [] }, { id: 'j3', assignees: [] }]) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      technicianJob: {
        findUnique: jest.fn(async () => ({ orderId: 'o1' })),
        findUniqueOrThrow: jest.fn(async () => ({ id: 'j1', status: 'dibatalkan' })),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    jest
      .spyOn(svc as any, 'cancelJobInTx')
      .mockResolvedValueOnce({ deletedUnitCount: 1 })
      .mockResolvedValueOnce({ deletedUnitCount: 0 })
      .mockResolvedValueOnce({ deletedUnitCount: 1 });
    const res: any = await svc.cancel('j1', 'a1', 'admin', { allInOrder: true });
    expect(res).toMatchObject({ cancelledCount: 3, deletedUnitCount: 2 });
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ count: 3, deletedUnits: 2 });
  });
});
