import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';
import { ServicePricingService } from './service-pricing.service';

// Guard akses job kini berbasis tabel assignees (semua teknisi job setara); di tes ini pemilik job = 't1'.
const ownerAssignee = {
  count: jest.fn(async ({ where }: any) => (where.technicianId === 't1' ? 1 : 0)),
};


// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Komplain pelanggan atas job yang sudah SELESAI: admin membuat job komplain baru (order baru tanpa nota) dari data job
// awal. Job awal tidak disentuh; job komplain punya temuan awal sendiri dan TIDAK ditagih (tanpa harga jasa).

const source = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  orderId: 'o1',
  memberId: 'm1',
  unitId: `u-${id}`,
  technicianId: 't1',
  status: 'selesai',
  type: 'cuci',
  workAddress: 'Ruko A, Mojokerto',
  workMapsUrl: 'https://maps.example/ruko-a',
  createdAt: new Date('2026-11-01T01:00:00Z'),
  member: { id: 'm1', name: 'Bu Sari' },
  unit: { brand: 'Daikin', model: 'FTV25', roomLocation: `Ruang ${id}`, barcodeValue: `ACUNIT-${id}` },
  ...extra,
});

function setup(
  opts: {
    sources?: ReturnType<typeof source>[];
    busy?: unknown[];
    baseExists?: boolean;
    users?: Record<string, { role: string; active: boolean }>;
    // Teknisi job awal (tabel assignees); bawaan hanya t1.
    assignees?: string[];
  } = {},
) {
  const sources = opts.sources ?? [source('j1')];
  const users = opts.users ?? { t1: { role: 'teknisi', active: true }, t2: { role: 'teknisi', active: true } };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    technicianJobAssignee: {
      ...ownerAssignee,
      findMany: jest.fn(async () => (opts.assignees ?? ['t1']).map((technicianId) => ({ technicianId }))),
    },
    technicianJob: {
      findUnique: jest.fn(async () => (opts.baseExists === false ? null : { orderId: 'o1' })),
      // Dua pemanggil: pengambilan job sumber (where.id) dan assertNoActiveJob (where.unitId = job aktif pada unit itu).
      findMany: jest.fn(async (args: any) =>
        args?.where?.id ? sources.filter((s) => args.where.id.in.includes(s.id)) : (opts.busy ?? []),
      ),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => users[where.id] ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        where.id.in.filter((id: string) => users[id]).map((id: string) => ({ id, ...users[id] })),
      ),
    },
    serviceOrder: { create: jest.fn(async (a: any) => ({ id: 'o-new', ...a.data })) },
    serviceOrderUnit: { create: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  const createForOrder = jest
    .spyOn(svc, 'createForOrder')
    .mockImplementation(async (_tx: any, p: any) => ({ id: `baru-${p.complaintOfJobId}`, technicianId: p.technicianId }) as any);
  return { svc, tx, prisma, createForOrder };
}

const dto = (extra: Record<string, unknown> = {}) => ({
  complaint: '  AC masih bocor setelah dicuci  ',
  scheduledDate: '2026-11-10',
  ...extra,
});

describe('TechnicianJobsService.createComplaint', () => {
  it('membuat ORDER BARU tanpa nota + job komplain dari data job awal (unit, lokasi, teknisi), keluhan jadi temuan awal', async () => {
    const { svc, tx, createForOrder } = setup();
    const r = await svc.createComplaint('j1', dto() as any, 'admin1');

    expect(tx.serviceOrder.create).toHaveBeenCalledWith({
      data: {
        memberId: 'm1',
        type: 'perbaikan',
        status: 'terjadwal',
        scheduledDate: new Date('2026-11-10'),
        createdById: 'admin1',
      },
    });
    // tanpa invoice: tidak ada baris harga/tagihan yang dibuat di sini
    expect(tx.serviceOrder.create.mock.calls[0][0].data).not.toHaveProperty('invoiceId');
    expect(tx.serviceOrderUnit.create).toHaveBeenCalledWith({
      data: { orderId: 'o-new', unitId: 'u-j1', status: 'terjadwal' },
    });
    expect(createForOrder).toHaveBeenCalledTimes(1);
    expect(createForOrder).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orderId: 'o-new',
        memberId: 'm1',
        unitId: 'u-j1',
        technicianIds: ['t1'], // bawaan: teknisi job awal
        type: 'perbaikan', // bukan cuci: persetujuan tidak mengubah jadwal pengingat
        actorId: 'admin1',
        complaint: 'AC masih bocor setelah dicuci',
        workAddress: 'Ruko A, Mojokerto',
        workMapsUrl: 'https://maps.example/ruko-a',
        complaintOfJobId: 'j1',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      orderId: 'o-new',
      jobId: 'baru-j1',
      technicianId: 't1',
      customerName: 'Bu Sari',
      jobs: [{ jobId: 'baru-j1', fromJobId: 'j1', unitId: 'u-j1' }],
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'job.complaint',
        target: 'baru-j1',
        detail: expect.objectContaining({ fromJobId: 'j1', fromOrderId: 'o1', orderId: 'o-new' }),
      }),
    });
  });

  it('beberapa unit dari satu order -> satu order komplain, satu job per unit', async () => {
    const { svc, tx, createForOrder } = setup({ sources: [source('j1'), source('j2')] });
    const r = await svc.createComplaint('j1', dto({ jobIds: ['j1', 'j2'] }) as any, 'admin1');
    expect(tx.serviceOrder.create).toHaveBeenCalledTimes(1);
    expect(createForOrder).toHaveBeenCalledTimes(2);
    expect(createForOrder.mock.calls.map((c: any) => c[1].complaintOfJobId)).toEqual(['j1', 'j2']);
    expect(createForOrder.mock.calls.every((c: any) => c[1].orderId === 'o-new')).toBe(true);
    expect(r.jobs.map((j) => j.fromJobId)).toEqual(['j1', 'j2']);
  });

  it('hanya job yang sudah Selesai yang bisa dikomplain', async () => {
    const { svc, tx } = setup({ sources: [source('j1', { status: 'sedang_dikerjakan' })] });
    await expect(svc.createComplaint('j1', dto() as any, 'admin1')).rejects.toThrow(/hanya untuk job yang sudah Selesai/);
    expect(tx.serviceOrder.create).not.toHaveBeenCalled();
  });

  it('unit pilihan harus dari order yang sama dengan job di URL', async () => {
    const { svc, tx } = setup({ sources: [source('j1'), source('j2', { orderId: 'o-lain' })] });
    await expect(svc.createComplaint('j1', dto({ jobIds: ['j1', 'j2'] }) as any, 'admin1')).rejects.toThrow(
      /order yang sama/,
    );
    expect(tx.serviceOrder.create).not.toHaveBeenCalled();
  });

  it('ditolak bila unit itu masih punya job aktif (tidak boleh menumpuk)', async () => {
    const { svc, tx } = setup({
      busy: [{ unit: { brand: 'Daikin', model: 'FTV25', roomLocation: 'Ruang j1', barcodeValue: 'ACUNIT-j1' } }],
    });
    await expect(svc.createComplaint('j1', dto() as any, 'admin1')).rejects.toThrow(/masih punya job servis yang belum selesai/);
    expect(tx.serviceOrder.create).not.toHaveBeenCalled();
  });

  it('keluhan wajib, jadwal harus valid, job harus ada', async () => {
    const a = setup();
    await expect(a.svc.createComplaint('j1', dto({ complaint: '   ' }) as any, 'admin1')).rejects.toThrow(BadRequestException);
    await expect(a.svc.createComplaint('j1', dto({ scheduledDate: 'bukan-tanggal' }) as any, 'admin1')).rejects.toThrow(
      /Jadwal tidak valid/,
    );
    const b = setup({ baseExists: false });
    await expect(b.svc.createComplaint('j1', dto() as any, 'admin1')).rejects.toThrow(NotFoundException);
    const c = setup({ sources: [] });
    await expect(c.svc.createComplaint('j1', dto() as any, 'admin1')).rejects.toThrow(/tidak ditemukan/);
  });

  it('teknisi: bawaan = teknisi job awal; null = belum ditentukan; id lain divalidasi; teknisi lama yang nonaktif -> belum ditentukan', async () => {
    const dflt = setup();
    expect((await dflt.svc.createComplaint('j1', dto() as any, 'a')).technicianId).toBe('t1');

    const none = setup();
    const r = await none.svc.createComplaint('j1', dto({ technicianId: null }) as any, 'a');
    expect(r.technicianId).toBeNull();
    expect(none.createForOrder).toHaveBeenCalledWith(none.tx, expect.objectContaining({ technicianIds: [] }));

    const other = setup();
    expect((await other.svc.createComplaint('j1', dto({ technicianId: 't2' }) as any, 'a')).technicianId).toBe('t2');

    const invalid = setup();
    await expect(invalid.svc.createComplaint('j1', dto({ technicianId: 'tidak-ada' }) as any, 'a')).rejects.toThrow(
      /Teknisi tidak valid/,
    );
    const kasir = setup({ users: { k1: { role: 'kasir', active: true } } });
    await expect(kasir.svc.createComplaint('j1', dto({ technicianId: 'k1' }) as any, 'a')).rejects.toThrow(/Teknisi tidak valid/);

    const inactive = setup({ users: { t1: { role: 'teknisi', active: false } } });
    expect((await inactive.svc.createComplaint('j1', dto() as any, 'a')).technicianId).toBeNull();
  });
});

describe('job komplain tidak ditagih', () => {
  it('approveComplete: job komplain TIDAK memeriksa harga jasa, job biasa tetap diperiksa', async () => {
    const make = (complaintOfJobId: string | null) => {
      const prisma: any = {
        technicianJobAssignee: ownerAssignee,
        technicianJob: {
          findUnique: jest.fn(async () => ({
            id: 'jk',
            orderId: 'ok',
            unitId: 'u1',
            type: 'perbaikan',
            status: 'menunggu_review',
            billingDerived: false,
            complaintOfJobId,
          })),
        },
        memberAcUnit: { findUnique: jest.fn(async () => ({ serviceIntervalDays: null })) },
        // Berhenti tepat sesudah gate harga, sebelum transaksi persetujuan sungguhan.
        $transaction: jest.fn(async () => {
          throw new Error('STOP');
        }),
      };
      const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
      const priced = jest
        .spyOn(svc as any, 'assertJobPriced')
        .mockRejectedValue(new BadRequestException('Harga jasa belum ditetapkan'));
      return { svc, priced };
    };

    const komplain = make('j-awal');
    await expect(komplain.svc.approveComplete('jk', 'admin')).rejects.toThrow('STOP');
    expect(komplain.priced).not.toHaveBeenCalled();

    const biasa = make(null);
    await expect(biasa.svc.approveComplete('jk', 'admin')).rejects.toThrow('Harga jasa belum ditetapkan');
    expect(biasa.priced).toHaveBeenCalledTimes(1);
  });

  it('sendFindings: job komplain ditolak (tidak ada harga yang perlu ditetapkan)', async () => {
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      technicianJobAssignee: ownerAssignee,
      technicianJob: {
        findUnique: jest.fn(async () => ({
          id: 'jk',
          technicianId: 't1',
          status: 'sedang_dikerjakan',
          complaintOfJobId: 'j-awal',
          member: { name: 'Bu Sari' },
          technician: { displayName: 'Andi' },
          findings: [{ title: 'Bocor', photos: [{ kind: 'sebelum' }] }],
        })),
        update: jest.fn(),
      },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.sendFindings('jk', 't1', 'teknisi')).rejects.toThrow(/Job komplain tidak ditagih/);
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
  });

  it('ServicePricingService.set: job komplain tidak bisa diberi harga jasa', async () => {
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      technicianJobAssignee: ownerAssignee,
      technicianJob: {
        findUnique: jest.fn(async () => ({
          id: 'jk',
          orderId: 'ok',
          type: 'perbaikan',
          status: 'assigned',
          complaintOfJobId: 'j-awal',
        })),
        findFirst: jest.fn(async () => ({ id: 'jk' })),
      },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const pricing = new ServicePricingService(prisma, {} as any, {} as any);
    await expect(pricing.set('jk', { lines: [] } as any, 'admin1')).rejects.toThrow(/Job komplain tidak ditagih/);
  });
});

describe('TechnicianJobsService.createComplaint — banyak teknisi', () => {
  const both = { t1: { role: 'teknisi', active: true }, t2: { role: 'teknisi', active: true } };

  it('bawaan: mewarisi SEMUA assignee aktif role teknisi dari job awal (yang nonaktif dibuang)', async () => {
    const { svc, tx, createForOrder } = setup({
      assignees: ['t1', 't2', 't3'],
      users: { ...both, t3: { role: 'teknisi', active: false } },
    });
    const r: any = await svc.createComplaint('j1', dto() as any, 'a');
    expect(createForOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ technicianIds: ['t1', 't2'] }));
    expect(r).toMatchObject({ technicianId: 't1', technicianIds: ['t1', 't2'] });
  });

  it('technicianIds eksplisit dipakai apa adanya; [] = belum ditentukan', async () => {
    const a = setup({ users: both });
    const r: any = await a.svc.createComplaint('j1', dto({ technicianIds: ['t2', 't1'] }) as any, 'a');
    expect(r.technicianIds).toEqual(['t2', 't1']);
    const b = setup({ users: both });
    const none: any = await b.svc.createComplaint('j1', dto({ technicianIds: [] }) as any, 'a');
    expect(none).toMatchObject({ technicianId: null, technicianIds: [] });
  });

  it('technicianIds berisi teknisi nonaktif / tidak ada -> 400', async () => {
    const { svc } = setup({ users: { ...both, t3: { role: 'teknisi', active: false } } });
    await expect(svc.createComplaint('j1', dto({ technicianIds: ['t1', 't3'] }) as any, 'a')).rejects.toThrow(
      /Teknisi tidak valid/,
    );
  });
});
