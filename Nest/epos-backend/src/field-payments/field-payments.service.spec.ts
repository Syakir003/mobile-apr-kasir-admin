import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldPaymentsService } from './field-payments.service';

// @nestjs/schedule ESM-only; terseret lewat modul lain. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

function setup(over: {
  job?: Record<string, unknown>;
  order?: Record<string, unknown>;
  invoice?: Record<string, unknown>;
  assignee?: boolean;
  pendingReq?: number;
  unusedReq?: number;
  activeSum?: number | null;
  dup?: Record<string, unknown> | null;
} = {}) {
  const job = { id: 'j1', orderId: 'o1', type: 'cuci', status: 'sedang_dikerjakan', complaintOfJobId: null, ...over.job };
  const order = { paymentMode: 'bayar_di_lokasi', invoiceId: 'inv1', ...over.order };
  const invoice = { id: 'inv1', grand_total: '150000', total_paid: '0', status: 'belum_dibayar', ...over.invoice };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => [invoice]),
    technicianJobAssignee: { count: jest.fn(async () => (over.assignee === false ? 0 : 1)) },
    technicianJob: { findUnique: jest.fn(async () => job), findMany: jest.fn(async () => [{ id: 'j1' }]) },
    serviceOrder: { findUnique: jest.fn(async () => order), update: jest.fn(async () => ({})) },
    materialRequest: {
      count: jest.fn(async ({ where }: any) => (where.status === 'pending' ? (over.pendingReq ?? 0) : (over.unusedReq ?? 0))),
    },
    fieldPayment: {
      findUnique: jest.fn(async () => over.dup ?? null),
      aggregate: jest.fn(async () => ({ _sum: { amount: over.activeSum ?? null } })),
      create: jest.fn(async ({ data }: any) => ({ id: 'fp1', ...data })),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const counters: any = { dateKey: jest.fn(() => '20261107'), nextSeq: jest.fn(async () => 12) };
  const svc = new FieldPaymentsService(prisma, counters, {} as any);
  return { svc, tx, counters, prisma };
}

const proof = '/uploads/payment-proofs/abc.jpg';
const lunas = { method: 'tunai' as const, amount: 150000 };

describe('FieldPaymentsService.record — mencatat pembayaran di lokasi', () => {
  it('tunai: status dipegang_teknisi, nomor Tanda Terima dari counter, bukti + audit tersimpan; invoice TIDAK disentuh', async () => {
    const { svc, tx, counters } = setup();
    const r = await svc.record('j1', lunas, proof, 't1');
    expect(counters.nextSeq).toHaveBeenCalledWith(tx, 'tanda_terima_20261107');
    expect(tx.fieldPayment.create).toHaveBeenCalledWith({
      data: {
        invoiceId: 'inv1', orderId: 'o1', recordedById: 't1', method: 'tunai', amount: 150000, note: null,
        proofUrl: proof, status: 'dipegang_teknisi', receiptNumber: 'TT-20261107-0012', clientRef: null,
      },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorUid: 't1', action: 'field_payment.create' });
    expect(r.duplicate).toBe(false);
    expect(r.payment).toMatchObject({ id: 'fp1', status: 'dipegang_teknisi' });
  });

  it.each(['transfer', 'qris', 'ewallet', 'debit'] as const)('%s: status menunggu_cocok (tidak ada uang yang dibawa pulang)', async (method) => {
    const { svc, tx } = setup();
    await svc.record('j1', { method, amount: 150000 }, proof, 't1');
    expect(tx.fieldPayment.create.mock.calls[0][0].data).toMatchObject({ status: 'menunggu_cocok' });
  });

  it('bayar sebagian wajib catatan; dengan catatan lolos', async () => {
    const a = setup();
    await expect(a.svc.record('j1', { method: 'tunai', amount: 50000 }, proof, 't1')).rejects.toThrow('sebagian');
    const b = setup();
    await b.svc.record('j1', { method: 'tunai', amount: 50000, note: ' DP, sisa besok ' }, proof, 't1');
    expect(b.tx.fieldPayment.create.mock.calls[0][0].data).toMatchObject({ amount: 50000, note: 'DP, sisa besok' });
  });

  it('sisa tagihan memperhitungkan pembayaran lapangan yang masih aktif', async () => {
    const { svc } = setup({ activeSum: 100000 });
    await expect(svc.record('j1', { method: 'tunai', amount: 60000, note: 'sisa' }, proof, 't1')).rejects.toThrow('Melebihi sisa tagihan');
    const ok = setup({ activeSum: 100000 });
    await expect(ok.svc.record('j1', { method: 'tunai', amount: 50000 }, proof, 't1')).resolves.toMatchObject({ duplicate: false });
  });

  it('tagihan sudah penuh (termasuk yang menunggu setoran): ditolak', async () => {
    const { svc } = setup({ activeSum: 150000 });
    await expect(svc.record('j1', { method: 'tunai', amount: 1000, note: 'x' }, proof, 't1')).rejects.toThrow('terbayar penuh');
  });

  it('clientRef yang sama dari perekam yang sama: mengembalikan catatan lama (idempoten), tidak membuat baru', async () => {
    const dup = { id: 'fp0', recordedById: 't1', clientRef: 'abc', amount: '150000' };
    const { svc, tx } = setup({ dup });
    const r = await svc.record('j1', { ...lunas, clientRef: 'abc' }, proof, 't1');
    // amount selalu angka di respons (Decimal Prisma jadi string di JSON)
    expect(r).toEqual({ payment: { ...dup, amount: 150000 }, duplicate: true });
    expect(tx.fieldPayment.create).not.toHaveBeenCalled();
  });

  it('clientRef milik perekam lain: ditolak', async () => {
    const { svc } = setup({ dup: { id: 'fp0', recordedById: 'tX', clientRef: 'abc' } });
    await expect(svc.record('j1', { ...lunas, clientRef: 'abc' }, proof, 't1')).rejects.toThrow('clientRef');
  });

  const tolak: [string, Parameters<typeof setup>[0], string][] = [
    ['job pemasangan', { job: { type: 'pemasangan' } }, 'kasir'],
    ['job komplain', { job: { complaintOfJobId: 'j0' } }, 'komplain'],
    ['job belum dimulai', { job: { status: 'assigned' } }, 'Sedang Dikerjakan'],
    ['job sudah diajukan', { job: { status: 'menunggu_review' } }, 'Sedang Dikerjakan'],
    ['order ditagih admin', { order: { paymentMode: 'ditagih_admin' } }, 'ditagih admin'],
    ['harga belum ditetapkan', { order: { invoiceId: null } }, 'belum ditetapkan'],
    ['pengajuan sparepart masih pending', { pendingReq: 1 }, 'belum diputuskan'],
    ['sparepart disetujui belum dilaporkan terpakai', { unusedReq: 1 }, 'tandai dipakai'],
    ['invoice sudah batal', { invoice: { status: 'batal' } }, 'batal'],
  ];
  it.each(tolak)('ditolak 400: %s (tidak ada yang ditulis)', async (_nama, over, pesan) => {
    const { svc, tx } = setup(over);
    await expect(svc.record('j1', lunas, proof, 't1')).rejects.toThrow(BadRequestException);
    await expect(svc.record('j1', lunas, proof, 't1')).rejects.toThrow(pesan);
    expect(tx.fieldPayment.create).not.toHaveBeenCalled();
  });

  it('bukan assignee job: 403', async () => {
    const { svc, tx } = setup({ assignee: false });
    await expect(svc.record('j1', lunas, proof, 't9')).rejects.toThrow(ForbiddenException);
    expect(tx.fieldPayment.create).not.toHaveBeenCalled();
  });
});

describe('FieldPaymentsService.record — kondisi dibaca SETELAH kunci order', () => {
  it('clientRef dan kondisi job dicek sesudah kunci order (dua request berbarengan terserialisasi)', async () => {
    const { svc, tx } = setup({ dup: null });
    await svc.record('j1', { ...lunas, clientRef: 'abc' }, proof, 't1');
    const lockAt = tx.$executeRaw.mock.invocationCallOrder[0];
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain('FROM service_orders');
    expect(tx.fieldPayment.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(lockAt);
    expect(tx.technicianJobAssignee.count.mock.invocationCallOrder[0]).toBeGreaterThan(lockAt);
  });

  it('status job dibaca ulang sesudah kunci: job dibatalkan selagi menunggu kunci = ditolak', async () => {
    const { svc, tx } = setup();
    const job = { id: 'j1', orderId: 'o1', type: 'cuci', complaintOfJobId: null };
    tx.technicianJob.findUnique = jest
      .fn()
      .mockResolvedValueOnce({ orderId: 'o1' }) // bacaan awal (tanpa kunci): hanya orderId
      .mockResolvedValueOnce({ ...job, status: 'dibatalkan' }); // bacaan ulang sesudah kunci
    await expect(svc.record('j1', lunas, proof, 't1')).rejects.toThrow('Sedang Dikerjakan');
    expect(tx.fieldPayment.create).not.toHaveBeenCalled();
  });

  it('sisa tagihan dihitung dari pembayaran aktif milik invoice yang sama', async () => {
    const { svc, tx } = setup();
    await svc.record('j1', lunas, proof, 't1');
    expect(tx.fieldPayment.aggregate.mock.calls[0][0].where).toEqual({
      invoiceId: 'inv1',
      status: { in: ['dipegang_teknisi', 'menunggu_cocok'] },
    });
  });

  it('alasan "belum bayar" dari Ajukan Selesai dibersihkan begitu pembayaran dicatat', async () => {
    const { svc, tx } = setup();
    await svc.record('j1', lunas, proof, 't1');
    expect(tx.serviceOrder.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { unpaidReason: null } });
  });

  it('jalur duplikat tidak menyentuh alasan di order', async () => {
    const { svc, tx } = setup({ dup: { id: 'fp0', recordedById: 't1', clientRef: 'abc', amount: '1' } });
    await svc.record('j1', { ...lunas, clientRef: 'abc' }, proof, 't1');
    expect(tx.serviceOrder.update).not.toHaveBeenCalled();
  });

  it('amount di respons berupa angka (bukan string Decimal)', async () => {
    const { svc } = setup();
    const r = await svc.record('j1', lunas, proof, 't1');
    expect(r.payment.amount).toBe(150000);
    expect(typeof r.payment.amount).toBe('number');
  });

  it('jaring pengaman: unique clientRef bentrok di luar kunci order -> kembalikan catatan lama milik perekam yang sama', async () => {
    const { svc, prisma } = setup();
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
    prisma.$transaction = jest.fn(async () => {
      throw p2002;
    });
    const dup = { id: 'fp0', recordedById: 't1', clientRef: 'abc', amount: '150000' };
    // Setelah transaksi gagal (PG membatalkan seluruh transaksi), pencarian harus lewat koneksi biasa, bukan tx.
    prisma.fieldPayment = { findUnique: jest.fn(async () => dup) };
    const r = await svc.record('j1', { ...lunas, clientRef: 'abc' }, proof, 't1');
    expect(r).toEqual({ payment: { ...dup, amount: 150000 }, duplicate: true });
    expect(prisma.fieldPayment.findUnique).toHaveBeenCalledWith({ where: { clientRef: 'abc' } });
  });

  it('jaring pengaman: P2002 tanpa catatan milik perekam yang sama dilempar ulang', async () => {
    const { svc, prisma } = setup();
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
    prisma.$transaction = jest.fn(async () => {
      throw p2002;
    });
    prisma.fieldPayment = { findUnique: jest.fn(async () => ({ id: 'fp0', recordedById: 'tLain', amount: '1' })) };
    await expect(svc.record('j1', { ...lunas, clientRef: 'abc' }, proof, 't1')).rejects.toBe(p2002);
  });
});
