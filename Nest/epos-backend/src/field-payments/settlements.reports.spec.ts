import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettlementsService } from './settlements.service';

jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// ---------- Pencatatan admin dari lembar kertas ----------
function paperSetup(over: {
  job?: Record<string, unknown> | null;
  assignee?: boolean;
  invoiceId?: string | null;
  invoice?: Record<string, unknown>;
  activeSum?: number | null;
  dup?: Record<string, unknown> | null;
} = {}) {
  const job = over.job === undefined ? { orderId: 'o1', type: 'cuci', complaintOfJobId: null } : over.job;
  const invoice = { id: 'inv1', grand_total: '150000', total_paid: '0', status: 'belum_dibayar', ...over.invoice };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => [invoice]),
    technicianJob: { findUnique: jest.fn(async () => job) },
    technicianJobAssignee: { count: jest.fn(async () => (over.assignee === false ? 0 : 1)) },
    serviceOrder: { findUnique: jest.fn(async () => ({ invoiceId: over.invoiceId === undefined ? 'inv1' : over.invoiceId })) },
    fieldPayment: {
      findUnique: jest.fn(async () => over.dup ?? null),
      aggregate: jest.fn(async () => ({ _sum: { amount: over.activeSum ?? null } })),
      create: jest.fn(async ({ data }: any) => ({ id: 'fp1', ...data })),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const counters: any = { dateKey: jest.fn(() => '20261107'), nextSeq: jest.fn(async () => 7) };
  return { svc: new SettlementsService(prisma, {} as any, counters), tx };
}

const paper = { jobId: 'j1', technicianId: 't1', method: 'tunai' as const, amount: 150000, paperReportNo: ' LP-0099 ' };

describe('SettlementsService.fromPaper — admin mencatat atas nama teknisi dari lembar kertas', () => {
  it('membuat pembayaran atas nama teknisi: saluran kertas, tanpa foto bukti, tercatat siapa yang memasukkan', async () => {
    const { svc, tx } = paperSetup();
    const r = await svc.fromPaper(paper, 'a1');
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain('FROM service_orders');
    expect(tx.fieldPayment.create).toHaveBeenCalledWith({
      data: {
        invoiceId: 'inv1', orderId: 'o1', recordedById: 't1', method: 'tunai', amount: 150000, note: null,
        proofUrl: null, status: 'dipegang_teknisi', receiptNumber: 'TT-20261107-0007', clientRef: null,
        receiptChannel: 'kertas', paperReportNo: 'LP-0099', source: 'kertas', enteredById: 'a1',
      },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorUid: 'a1', action: 'field_payment.create' });
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ source: 'kertas', technicianId: 't1' });
    expect(r.duplicate).toBe(false);
    expect(r.payment.amount).toBe(150000);
  });

  it('non-tunai dari kertas: menunggu_cocok', async () => {
    const { svc, tx } = paperSetup();
    await svc.fromPaper({ ...paper, method: 'transfer' }, 'a1');
    expect(tx.fieldPayment.create.mock.calls[0][0].data).toMatchObject({ status: 'menunggu_cocok' });
  });

  it('batas sisa tagihan dan catatan pembayaran sebagian berlaku sama seperti catatan teknisi', async () => {
    await expect(paperSetup({ activeSum: 100000 }).svc.fromPaper({ ...paper, amount: 60000, note: 'sisa' }, 'a1')).rejects.toThrow('Melebihi sisa tagihan');
    await expect(paperSetup().svc.fromPaper({ ...paper, amount: 50000 }, 'a1')).rejects.toThrow('sebagian');
    await expect(paperSetup({ activeSum: 150000 }).svc.fromPaper({ ...paper, amount: 1000, note: 'xx' }, 'a1')).rejects.toThrow('terbayar penuh');
  });

  const tolak: [string, Parameters<typeof paperSetup>[0], string][] = [
    ['teknisi bukan petugas job itu', { assignee: false }, 'bukan petugas'],
    ['job pemasangan', { job: { orderId: 'o1', type: 'pemasangan', complaintOfJobId: null } }, 'Pemasangan'],
    ['job komplain', { job: { orderId: 'o1', type: 'cuci', complaintOfJobId: 'j0' } }, 'komplain'],
    ['order belum dihargai', { invoiceId: null }, 'belum ditetapkan'],
    ['invoice sudah batal', { invoice: { status: 'batal' } }, 'batal'],
  ];
  it.each(tolak)('ditolak: %s', async (_n, over, pesan) => {
    const { svc, tx } = paperSetup(over);
    await expect(svc.fromPaper(paper, 'a1')).rejects.toThrow(BadRequestException);
    await expect(svc.fromPaper(paper, 'a1')).rejects.toThrow(pesan);
    expect(tx.fieldPayment.create).not.toHaveBeenCalled();
  });

  it('job tidak ada: 404; clientRef sama dari teknisi yang sama: mengembalikan yang lama', async () => {
    await expect(paperSetup({ job: null }).svc.fromPaper(paper, 'a1')).rejects.toThrow(NotFoundException);
    const dup = { id: 'fp0', recordedById: 't1', clientRef: 'k1', amount: '150000' };
    const { svc, tx } = paperSetup({ dup });
    const r = await svc.fromPaper({ ...paper, clientRef: 'k1' }, 'a1');
    expect(r).toEqual({ payment: { ...dup, amount: 150000 }, duplicate: true });
    expect(tx.fieldPayment.create).not.toHaveBeenCalled();
  });
});

// ---------- Daftar menunggu cocok & laporan ----------
describe('SettlementsService.awaiting — menunggu dicocokkan dengan mutasi', () => {
  it('daftar non-tunai tertua dulu, lengkap dengan perekam dan pelanggan', async () => {
    const prisma: any = {
      fieldPayment: {
        findMany: jest.fn(async () => [
          {
            id: 'p1', receiptNumber: 'TT-1', method: 'qris', amount: '90000', proofUrl: '/u/a.jpg', createdAt: new Date('2026-11-07T03:00:00Z'),
            invoice: { number: 'INV-1', customerName: 'Bu Sari' }, recordedBy: { id: 't1', displayName: 'Budi' },
          },
        ]),
      },
    };
    const svc = new SettlementsService(prisma, {} as any, {} as any);
    const r = await svc.awaiting();
    expect(prisma.fieldPayment.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'menunggu_cocok' },
      orderBy: { createdAt: 'asc' },
    });
    expect(r.items[0]).toMatchObject({ id: 'p1', amount: 90000, invoiceNumber: 'INV-1', customerName: 'Bu Sari', technician: { displayName: 'Budi' } });
    expect(r.total).toBe(90000);
  });
});

describe('SettlementsService.technicianCash — laporan Uang di Teknisi', () => {
  it('per teknisi: uang dipegang + umur tertua, menunggu cocok, saldo, selisih ditutup alasan (30 hari), kelebihan pelanggan', async () => {
    const now = new Date('2026-11-10T03:00:00Z');
    const prisma: any = {
      user: { findMany: jest.fn(async () => [{ id: 't1', displayName: 'Budi' }, { id: 't2', displayName: 'Ani' }]) },
      fieldPayment: {
        groupBy: jest.fn(async ({ where }: any) =>
          where.status === 'dipegang_teknisi'
            ? [{ recordedById: 't1', _sum: { amount: 250000 }, _count: { _all: 2 }, _min: { createdAt: new Date('2026-11-07T03:00:00Z') } }]
            : [{ recordedById: 't2', _count: { _all: 1 } }],
        ),
      },
      technicianCashEntry: {
        groupBy: jest.fn(async ({ where }: any) =>
          where.createdAt
            ? [{ technicianId: 't1', _sum: { amount: 40000 }, _count: { _all: 2 } }]
            : [
                { technicianId: 't1', kind: 'kurang_setor', _sum: { amount: 30000 } },
                { technicianId: 't1', kind: 'pelunasan', _sum: { amount: -10000 } },
                { technicianId: 't2', kind: 'kelebihan_pelanggan', _sum: { amount: 15000 } },
              ],
        ),
      },
    };
    const svc = new SettlementsService(prisma, {} as any, {} as any);
    const r = await svc.technicianCash(now);
    const budi = r.find((x) => x.technicianId === 't1')!;
    const ani = r.find((x) => x.technicianId === 't2')!;
    expect(budi).toMatchObject({
      displayName: 'Budi', heldTotal: 250000, heldCount: 2, oldestHeldAgeDays: 3, awaitingCount: 0,
      saldo: 20000, closedWithReason30d: { count: 2, total: 40000 }, excessCustomer: 0,
    });
    expect(ani).toMatchObject({ heldTotal: 0, heldCount: 0, oldestHeldAgeDays: null, awaitingCount: 1, saldo: 0, excessCustomer: 15000 });
    // 30 hari ke belakang dihitung dari "sekarang"
    const closedWhere = prisma.technicianCashEntry.groupBy.mock.calls.find((c: any) => c[0].where.createdAt)[0].where;
    expect(closedWhere.kind).toBe('ditutup_alasan');
    expect(closedWhere.createdAt.gte.getTime()).toBe(now.getTime() - 30 * 86400000);
  });
});

// ---------- Cron uang tertahan ----------
describe('SettlementsService.notifyAdminsCashOverdue', () => {
  function make(existing = false) {
    const prisma: any = {
      fieldPayment: {
        groupBy: jest.fn(async () => [
          { recordedById: 't1', _sum: { amount: 250000 }, _count: { _all: 2 }, _min: { createdAt: new Date('2026-11-07T03:00:00Z') } },
        ]),
      },
      user: {
        findMany: jest.fn(async ({ where }: any) =>
          where.role === 'admin' ? [{ id: 'a1' }, { id: 'a2' }] : [{ id: 't1', displayName: 'Budi' }],
        ),
      },
      notification: { findFirst: jest.fn(async () => (existing ? { id: 'n0' } : null)) },
    };
    const notifications: any = { notify: jest.fn(async () => undefined) };
    return { svc: new SettlementsService(prisma, notifications, {} as any), prisma, notifications };
  }

  it('uang tunai yang dibuat sebelum hari ini dikabarkan ke tiap admin (satu per teknisi)', async () => {
    const { svc, prisma, notifications } = make();
    const now = new Date('2026-11-10T02:00:00Z');
    const n = await svc.notifyAdminsCashOverdue(now);
    expect(n).toBe(2);
    const where = prisma.fieldPayment.groupBy.mock.calls[0][0].where;
    expect(where.status).toBe('dipegang_teknisi');
    expect(where.createdAt.lt.toISOString()).toBe('2026-11-09T17:00:00.000Z'); // awal hari ini WIB
    const [adminId, payload] = notifications.notify.mock.calls[0];
    expect(adminId).toBe('a1');
    expect(payload).toMatchObject({ type: 'cash_overdue', target: 't1' });
    expect(payload.title).toContain('Budi');
    expect(payload.body).toContain('250.000');
  });

  it('admin yang sudah dikabari hari ini tidak dikirimi lagi (aman dijalankan ulang)', async () => {
    const { svc, notifications } = make(true);
    expect(await svc.notifyAdminsCashOverdue(new Date('2026-11-10T02:00:00Z'))).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('tidak ada uang tertahan: tidak ada notifikasi', async () => {
    const { svc, prisma, notifications } = make();
    prisma.fieldPayment.groupBy = jest.fn(async () => []);
    expect(await svc.notifyAdminsCashOverdue()).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

// ---------- Bahan layar Setoran ----------
describe('SettlementsService.pending', () => {
  function make(over: { role?: string; tech?: boolean } = {}) {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () =>
          over.tech === false ? null : { id: 't1', displayName: 'Budi', role: over.role ?? 'teknisi' },
        ),
      },
      fieldPayment: {
        findMany: jest.fn(async () => [
          {
            id: 'p1', receiptNumber: 'TT-1', amount: '100000', method: 'tunai', proofUrl: '/u/a.jpg', receiptChannel: 'wa',
            source: 'app', createdAt: new Date(Date.now() - 2 * 86400000), invoice: { number: 'INV-1', customerName: 'Bu Sari' },
          },
          {
            id: 'p2', receiptNumber: 'TT-2', amount: '50000', method: 'tunai', proofUrl: null, receiptChannel: 'kertas',
            source: 'kertas', createdAt: new Date(), invoice: { number: 'INV-2', customerName: 'Pak Budi' },
          },
        ]),
      },
      technicianCashEntry: { aggregate: jest.fn(async () => ({ _sum: { amount: 25000 } })) },
      materialRequest: {
        findMany: jest.fn(async () => [
          {
            id: 'm1', job: { member: { name: 'Bu Sari' } },
            items: [
              { name: 'Kapasitor 35uF', unit: 'pcs', qty: '3', qtyUsed: '1' },
              { name: 'Freon R32', unit: 'kg', qty: '2', qtyUsed: null },
            ],
          },
        ]),
      },
    };
    return { svc: new SettlementsService(prisma, {} as any, {} as any), prisma };
  }

  it('tunai yang dipegang (semua hari), total seharusnya, saldo, dan sparepart yang harus kembali', async () => {
    const { svc, prisma } = make();
    const r = await svc.pending('t1', '2026-11-10');
    expect(prisma.fieldPayment.findMany.mock.calls[0][0].where).toEqual({ recordedById: 't1', status: 'dipegang_teknisi' });
    expect(r.payments.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(r.payments[0]).toMatchObject({ amount: 100000, invoiceNumber: 'INV-1', customerName: 'Bu Sari', ageDays: 2 });
    expect(r.expectedTotal).toBe(150000);
    expect(r.saldo).toBe(25000);
    expect(r.sparepartReturns).toEqual([
      {
        requestId: 'm1',
        customerName: 'Bu Sari',
        items: [
          { name: 'Kapasitor 35uF', unit: 'pcs', approved: 3, used: 1, toReturn: 2 },
          // belum dilaporkan terpakai = dianggap terpakai penuh (tidak ada yang kembali)
          { name: 'Freon R32', unit: 'kg', approved: 2, used: 2, toReturn: 0 },
        ],
      },
    ]);
  });

  it('tanggal dikembalikan sebagai tanggal kalender WIB yang diminta (bukan mundur sehari karena UTC)', async () => {
    const { svc, prisma } = make();
    const r = await svc.pending('t1', '2026-11-10');
    expect(r.date).toBe('2026-11-10');
    // pengajuan sparepart difilter pada rentang hari itu menurut WIB
    const w = prisma.materialRequest.findMany.mock.calls[0][0].where;
    expect(w).toMatchObject({ createdById: 't1', status: 'approved' });
    expect(w.decidedAt.gte.toISOString()).toBe('2026-11-09T17:00:00.000Z');
    expect(w.decidedAt.lte.toISOString()).toBe('2026-11-10T16:59:59.999Z');
  });

  it('bukan teknisi / tidak ada: 404; tanggal ngawur: 400', async () => {
    await expect(make({ tech: false }).svc.pending('x')).rejects.toThrow(NotFoundException);
    await expect(make({ role: 'kasir' }).svc.pending('t1')).rejects.toThrow(NotFoundException);
    await expect(make().svc.pending('t1', 'bukan-tanggal')).rejects.toThrow(BadRequestException);
  });
});
