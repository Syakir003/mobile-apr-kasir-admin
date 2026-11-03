import { ServicePricingService } from './service-pricing.service';

// Servis banyak AC: harga jasa SATU untuk seluruh job. Datanya di "job pemegang harga" (job pertama yang belum
// dibatalkan); id job mana pun di order itu menunjuk ke pemegang yang sama, dan unit lain hanya ditandai dihargai.

type J = { id: string; orderId: string; type: string; status: string; createdAt: Date; technicianId: string | null; billingDerived: boolean };
const at = (n: number) => new Date(`2026-11-03T08:00:0${n}.000Z`);
const job = (id: string, n: number, over: Partial<J> = {}): J => ({
  id, orderId: 'o1', type: 'cuci', status: 'sedang_dikerjakan', createdAt: at(n), technicianId: 't1', billingDerived: false, ...over,
});

function setup(list: J[]) {
  const jobs = new Map(list.map((j) => [j.id, { ...j }]));
  const active = () => [...jobs.values()].filter((j) => j.status !== 'dibatalkan').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    technicianJob: {
      findUnique: jest.fn(async ({ where }: any) => (jobs.has(where.id) ? { ...jobs.get(where.id) } : null)),
      findFirst: jest.fn(async ({ where }: any) => {
        const first = active().find((j) => j.orderId === where.orderId);
        return first ? { id: first.id } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...jobs.values()]
          .filter((j) => j.orderId === where.orderId && (!where.id?.not || j.id !== where.id.not) && (!where.status?.not || j.status !== where.status.not))
          .map((j) => ({ id: j.id })),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        Object.assign(jobs.get(where.id)!, data);
        return { ...jobs.get(where.id) };
      }),
    },
    serviceOrder: { findUnique: jest.fn(async () => ({ id: 'o1', invoiceId: 'inv1' })) },
    jobServiceLine: { deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async () => ({ count: 1 })) },
    auditLog: { create: jest.fn(async () => ({})) },
    invoice: { findUnique: jest.fn(async () => ({ id: 'inv1', number: 'INV-1', status: 'belum_dibayar', grandTotal: 0, totalPaid: 0 })) },
    service: { findUnique: jest.fn() },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)), ...tx };
  const billing: any = { rebuild: jest.fn(async () => ({ newTotal: 150000 })) };
  const svc = new ServicePricingService(prisma, {} as any, billing);
  return { svc, tx, prisma, billing, jobs };
}

const dto = { lines: [{ name: 'Cuci AC 3 unit', qty: 1, unitPrice: 150000 }] } as any;

describe('ServicePricingService.set — harga jasa satu untuk seluruh job', () => {
  it('dipanggil dengan job unit mana pun: baris jasa ditulis ke job pemegang harga (job pertama)', async () => {
    const { svc, tx } = setup([job('j1', 1), job('j2', 2), job('j3', 3)]);
    await svc.set('j3', dto, 'a1');
    expect(tx.jobServiceLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ jobId: 'j1', name: 'Cuci AC 3 unit', unitPrice: 150000 })],
    });
  });

  it('unit lain ditandai sudah dihargai, tanpa baris jasa/transport sendiri, dan tagihannya dihitung ulang', async () => {
    const { svc, tx, billing, jobs } = setup([job('j1', 1), job('j2', 2, { billingDerived: false }), job('j3', 3)]);
    await svc.set('j1', { ...dto, transportLevel: 1 }, 'a1');
    expect(jobs.get('j2')).toMatchObject({ billingDerived: true });
    expect(jobs.get('j3')).toMatchObject({ billingDerived: true });
    // sisa baris lama per unit (data sebelum harga jadi satu) dibersihkan di unit lain
    expect(tx.jobServiceLine.deleteMany).toHaveBeenCalledWith({ where: { jobId: 'j2' } });
    expect(tx.jobServiceLine.deleteMany).toHaveBeenCalledWith({ where: { jobId: 'j3' } });
    expect(billing.rebuild.mock.calls.map((c: any) => c[1])).toEqual(['j1', 'j2', 'j3']);
  });

  it('unit pertama dibatalkan: pemegang harga = unit aktif pertama berikutnya; unit dibatalkan tidak ikut', async () => {
    const { svc, tx, billing, jobs } = setup([job('j1', 1, { status: 'dibatalkan' }), job('j2', 2), job('j3', 3)]);
    await svc.set('j1', dto, 'a1');
    expect(tx.jobServiceLine.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ jobId: 'j2' })] });
    expect(jobs.get('j1')).toMatchObject({ billingDerived: false });
    expect(billing.rebuild.mock.calls.map((c: any) => c[1])).toEqual(['j2', 'j3']);
  });

  it('pemasangan (invoice POS) dan order satu job: tidak ada unit lain yang disentuh', async () => {
    const one = setup([job('j1', 1)]);
    await one.svc.set('j1', dto, 'a1');
    expect(one.billing.rebuild.mock.calls.map((c: any) => c[1])).toEqual(['j1']);
    const inst = setup([job('j1', 1, { type: 'pemasangan' }), job('j2', 2, { type: 'pemasangan' })]);
    await inst.svc.set('j2', dto, 'a1');
    expect(inst.tx.jobServiceLine.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ jobId: 'j2' })] });
    expect(inst.billing.rebuild.mock.calls.map((c: any) => c[1])).toEqual(['j2']);
  });

  it('job pemegang harga yang sudah selesai tidak bisa diubah harganya', async () => {
    const { svc } = setup([job('j1', 1, { status: 'selesai' }), job('j2', 2)]);
    await expect(svc.set('j2', dto, 'a1')).rejects.toThrow(/tidak bisa diubah setelah job selesai/);
  });
});

describe('ServicePricingService.get — id job mana pun menunjuk pemegang harga yang sama', () => {
  it('get dari unit ketiga mengembalikan data pemegang harga (job pertama)', async () => {
    const { svc, prisma } = setup([job('j1', 1, { billingDerived: true }), job('j2', 2), job('j3', 3)]);
    prisma.technicianJob.findUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id, orderId: 'o1', type: 'cuci', status: 'sedang_dikerjakan', billingDerived: true, technicianId: 't1',
      findingsSentAt: null, transportLevel: 0, transportMode: 'individu', serviceLines: [],
      order: { invoiceId: 'inv1', invoice: { id: 'inv1', number: 'INV-1', status: 'belum_dibayar', grandTotal: '0', totalPaid: '0' } },
    }));
    prisma.materialRequest = { findMany: jest.fn(async () => []) };
    prisma.invoiceItem = { findMany: jest.fn(async () => []) };
    const res: any = await svc.get('j3');
    expect(res.jobId).toBe('j1');
    expect(res.priced).toBe(true);
    // tagihan & sparepart dihimpun dari SEMUA unit order
    expect(prisma.invoiceItem.findMany.mock.calls[0][0].where.jobId).toEqual({ in: ['j1', 'j2', 'j3'] });
    expect(prisma.materialRequest.findMany.mock.calls[0][0].where.jobId).toEqual({ in: ['j1', 'j2', 'j3'] });
  });
});
