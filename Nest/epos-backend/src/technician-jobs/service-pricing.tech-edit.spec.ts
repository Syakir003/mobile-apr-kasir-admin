import { ForbiddenException } from '@nestjs/common';
import { ServicePricingService } from './service-pricing.service';

// Teknisi (assignee) boleh MELIHAT harga jasa job-nya; penyesuaian ada di blok describe berikutnya (Task 3).

describe('ServicePricingService.getFor — akses baca harga', () => {
  function make(isAssignee: boolean) {
    const prisma: any = { technicianJobAssignee: { count: jest.fn(async () => (isAssignee ? 1 : 0)) } };
    const svc = new ServicePricingService(prisma, {} as any, {} as any);
    const get = jest.spyOn(svc, 'get').mockResolvedValue({ jobId: 'j1' } as any);
    return { svc, prisma, get };
  }

  it('teknisi yang bukan assignee ditolak dan data tidak dibaca', async () => {
    const { svc, get } = make(false);
    await expect(svc.getFor('j1', 't9', 'teknisi')).rejects.toThrow(ForbiddenException);
    expect(get).not.toHaveBeenCalled();
  });

  it('teknisi assignee boleh membaca', async () => {
    const { svc, prisma, get } = make(true);
    await expect(svc.getFor('j1', 't1', 'teknisi')).resolves.toEqual({ jobId: 'j1' });
    expect(prisma.technicianJobAssignee.count).toHaveBeenCalledWith({ where: { jobId: 'j1', technicianId: 't1' } });
    expect(get).toHaveBeenCalledWith('j1');
  });

  it('admin/kasir tidak perlu menjadi assignee', async () => {
    const { svc, prisma, get } = make(false);
    await svc.getFor('j1', 'a1', 'admin');
    await svc.getFor('j1', 'k1', 'kasir');
    expect(prisma.technicianJobAssignee.count).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('ServicePricingService.get — field penyesuaian teknisi', () => {
  function make(over: Record<string, unknown> = {}) {
    const job = {
      id: 'j1', orderId: 'o1', type: 'cuci', status: 'sedang_dikerjakan', findingsSentAt: null, billingDerived: true,
      transportLevel: 0, transportMode: 'individu',
      techPriceEditedAt: null, techPriceEditReason: null, priceBeforeTechEdit: null,
      serviceLines: [
        { id: 'l1', serviceId: 's1', name: 'Cuci AC', qty: 3, unitPrice: 75000, source: 'teknisi', isCustom: false, changeReason: 'Unit ketiga ikut dicuci' },
      ],
      order: { invoiceId: 'inv1', invoice: { id: 'inv1', number: 'INV-1', status: 'belum_dibayar', grandTotal: 225000, totalPaid: 0 } },
      ...over,
    };
    const prisma: any = {
      technicianJob: {
        findUnique: jest.fn(async () => job),
        findFirst: jest.fn(async () => ({ id: 'j1' })),
        findMany: jest.fn(async () => [{ id: 'j1' }]),
      },
      materialRequest: { findMany: jest.fn(async () => []) },
      invoiceItem: { findMany: jest.fn(async () => []) },
    };
    return { svc: new ServicePricingService(prisma, {} as any, {} as any), job };
  }

  it('baris membawa source/isCustom/changeReason dan ada blok techEdit', async () => {
    const at = new Date('2026-11-11T03:00:00Z');
    const { svc } = make({ techPriceEditedAt: at, techPriceEditReason: 'Unit ketiga ikut dicuci', priceBeforeTechEdit: 150000 });
    const r = await svc.get('j1');
    expect(r.lines[0]).toMatchObject({ id: 'l1', source: 'teknisi', isCustom: false, changeReason: 'Unit ketiga ikut dicuci' });
    expect(r.techEdit).toEqual({ at, reason: 'Unit ketiga ikut dicuci', subtotalBefore: 150000, subtotalAfter: 225000 });
  });

  it('techEdit null bila jasa belum pernah disesuaikan teknisi', async () => {
    const { svc } = make();
    const r = await svc.get('j1');
    expect(r.techEdit).toBeNull();
  });
});
