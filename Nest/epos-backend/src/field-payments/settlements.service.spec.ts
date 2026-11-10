import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { applyFieldPaymentTx } from './apply-field-payment.util';

jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));
jest.mock('./apply-field-payment.util', () => ({
  applyFieldPaymentTx: jest.fn(async (_tx: unknown, fp: any) => ({
    applied: Number(fp.amount),
    excess: 0,
    invoiceStatus: 'lunas',
    manualPaymentId: `mp-${fp.id}`,
  })),
}));

const pay = (id: string, amount: number, over: Record<string, unknown> = {}) => ({
  id,
  invoiceId: `inv-${id}`,
  orderId: `o-${id}`,
  method: 'tunai',
  amount,
  status: 'dipegang_teknisi',
  recordedById: 't1',
  receiptNumber: `TT-${id}`,
  proofUrl: null,
  ...over,
});

function setup(over: { fps?: any[]; saldo?: number | null; single?: any } = {}) {
  const fps = over.fps ?? [pay('p2', 50000), pay('p1', 100000)];
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    fieldPayment: {
      findMany: jest.fn(async () => fps),
      findUnique: jest.fn(async () => (over.single === undefined ? fps[0] : over.single)),
      update: jest.fn(async () => ({})),
    },
    cashSettlement: { create: jest.fn(async ({ data }: any) => ({ id: 's1', ...data })) },
    technicianCashEntry: {
      create: jest.fn(async () => ({})),
      aggregate: jest.fn(async () => ({ _sum: { amount: over.saldo === undefined ? 0 : over.saldo } })),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)), ...tx };
  const notifications: any = { notify: jest.fn(async () => undefined), notifyRoles: jest.fn(async () => undefined) };
  return { svc: new SettlementsService(prisma, notifications, {} as any), tx, prisma, notifications };
}

const ids = ['p1', 'p2'];
const base = { technicianId: 't1', paymentIds: ids, receivedTotal: 150000 };

beforeEach(() => (applyFieldPaymentTx as jest.Mock).mockClear());

describe('SettlementsService.settle — setoran tunai', () => {
  it('pas: semua pembayaran diverifikasi (urut invoice), order dikunci dulu, tanpa catatan selisih', async () => {
    const { svc, tx } = setup();
    const r = await svc.settle(base, 'a1');
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain('FROM service_orders');
    const applied = (applyFieldPaymentTx as jest.Mock).mock.calls.map((c) => c[1].id);
    expect(applied).toEqual(['p1', 'p2']); // urut invoiceId (inv-p1 < inv-p2) supaya kunci invoice konsisten
    expect((applyFieldPaymentTx as jest.Mock).mock.calls[0][2]).toBe('a1');
    expect((applyFieldPaymentTx as jest.Mock).mock.calls[0][3]).toEqual({ settlementId: 's1' });
    expect(tx.cashSettlement.create.mock.calls[0][0].data).toMatchObject({
      technicianId: 't1',
      expectedTotal: 150000,
      receivedTotal: 150000,
      difference: 0,
      mode: null,
      createdById: 'a1',
    });
    expect(tx.cashSettlement.create.mock.calls[0][0].data.businessDate).toBeInstanceOf(Date);
    expect(tx.technicianCashEntry.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'settlement.create', target: 's1' });
    expect(r).toMatchObject({ settlementId: 's1', expectedTotal: 150000, difference: 0 });
    expect(r.results).toHaveLength(2);
  });

  it('kurang tanpa memilih penanganan: ditolak', async () => {
    const { svc, tx } = setup();
    await expect(svc.settle({ ...base, receivedTotal: 140000 }, 'a1')).rejects.toThrow('Ada selisih');
    expect(applyFieldPaymentTx).not.toHaveBeenCalled();
    expect(tx.cashSettlement.create).not.toHaveBeenCalled();
  });

  it('catat_kurang: selisih jadi saldo kurang-setor teknisi, invoice tetap dilunasi penuh', async () => {
    const { svc, tx } = setup();
    await svc.settle({ ...base, receivedTotal: 140000, mode: 'catat_kurang' }, 'a1');
    expect(applyFieldPaymentTx).toHaveBeenCalledTimes(2);
    expect(tx.cashSettlement.create.mock.calls[0][0].data).toMatchObject({ difference: -10000, mode: 'catat_kurang' });
    expect(tx.technicianCashEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        technicianId: 't1',
        settlementId: 's1',
        kind: 'kurang_setor',
        amount: 10000,
        createdById: 'a1',
      }),
    });
  });

  it('selesai_dengan_alasan: alasan konkret (min. 10 karakter) wajib; selisih ditutup, tidak jadi saldo, ada audit khusus', async () => {
    await expect(
      setup().svc.settle({ ...base, receivedTotal: 140000, mode: 'selesai_dengan_alasan', reason: 'ada nota' }, 'a1'),
    ).rejects.toThrow('Alasan');
    const { svc, tx } = setup();
    await svc.settle(
      { ...base, receivedTotal: 140000, mode: 'selesai_dengan_alasan', reason: 'Dipakai beli freon, nota terlampir' },
      'a1',
    );
    expect(tx.technicianCashEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'ditutup_alasan', amount: 10000, note: 'Dipakai beli freon, nota terlampir' }),
    });
    const actions = tx.auditLog.create.mock.calls.map((c: any) => c[0].data.action);
    expect(actions).toContain('settlement.difference_closed');
  });

  it('lebih: catat_lebih mengurangi saldo (negatif); mode yang tidak cocok dengan arah selisih ditolak', async () => {
    const { svc, tx } = setup();
    await svc.settle({ ...base, receivedTotal: 155000, mode: 'catat_lebih' }, 'a1');
    expect(tx.technicianCashEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'lebih_setor', amount: -5000 }),
    });
    await expect(setup().svc.settle({ ...base, receivedTotal: 155000, mode: 'catat_kurang' }, 'a1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(setup().svc.settle({ ...base, receivedTotal: 140000, mode: 'catat_lebih' }, 'a1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('pas tetapi mode dikirim: mode diabaikan (tidak ada catatan selisih)', async () => {
    const { svc, tx } = setup();
    await svc.settle({ ...base, mode: 'catat_kurang' }, 'a1');
    expect(tx.technicianCashEntry.create).not.toHaveBeenCalled();
  });

  it.each([
    ['pembayaran milik teknisi lain', [pay('p1', 100000, { recordedById: 'tX' }), pay('p2', 50000)], 'bukan milik'],
    ['bukan tunai', [pay('p1', 100000, { method: 'transfer' }), pay('p2', 50000)], 'tunai'],
    ['sudah diverifikasi', [pay('p1', 100000, { status: 'diverifikasi' }), pay('p2', 50000)], 'sudah diproses'],
    ['ada id yang tidak ditemukan', [pay('p1', 100000)], 'tidak ditemukan'],
  ])('ditolak: %s (tidak ada yang ditulis)', async (_n, fps, pesan) => {
    const { svc, tx } = setup({ fps });
    await expect(svc.settle(base, 'a1')).rejects.toThrow(pesan);
    expect(applyFieldPaymentTx).not.toHaveBeenCalled();
    expect(tx.cashSettlement.create).not.toHaveBeenCalled();
  });
});

describe('SettlementsService.verify / reject (non-tunai)', () => {
  it('verify: transfer menunggu_cocok -> dilunasi (order dikunci dulu)', async () => {
    const { svc, tx } = setup({ single: pay('p1', 100000, { method: 'transfer', status: 'menunggu_cocok' }) });
    const r = await svc.verify('p1', 'a1');
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain('FROM service_orders');
    expect((applyFieldPaymentTx as jest.Mock).mock.calls[0][3]).toEqual({ settlementId: null });
    expect(r).toMatchObject({ applied: 100000 });
  });

  it('verify: tunai harus lewat Setoran; yang sudah diproses atau tidak ada ditolak', async () => {
    await expect(setup({ single: pay('p1', 1, { status: 'dipegang_teknisi' }) }).svc.verify('p1', 'a1')).rejects.toThrow(
      'Setoran',
    );
    await expect(
      setup({ single: pay('p1', 1, { method: 'qris', status: 'diverifikasi' }) }).svc.verify('p1', 'a1'),
    ).rejects.toThrow('sudah diproses');
    await expect(setup({ single: null }).svc.verify('p1', 'a1')).rejects.toThrow(NotFoundException);
  });

  it('reject: alasan wajib (min. 5), status ditolak, teknisi dikabari', async () => {
    await expect(
      setup({ single: pay('p1', 1, { status: 'menunggu_cocok' }) }).svc.reject('p1', ' ab ', 'a1'),
    ).rejects.toThrow('Alasan');
    const { svc, tx, notifications } = setup({
      single: pay('p1', 100000, { method: 'transfer', status: 'menunggu_cocok' }),
    });
    await svc.reject('p1', 'Transfer tidak masuk di mutasi', 'a1');
    const upd = tx.fieldPayment.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'p1' });
    expect(upd.data).toMatchObject({ status: 'ditolak', rejectReason: 'Transfer tidak masuk di mutasi', verifiedById: 'a1' });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'field_payment.reject', target: 'p1' });
    expect(notifications.notify).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ type: 'field_payment_rejected', target: 'p1' }),
    );
    expect(applyFieldPaymentTx).not.toHaveBeenCalled();
  });

  it('reject: pembayaran yang sudah diverifikasi/ditolak tidak bisa ditolak lagi', async () => {
    await expect(
      setup({ single: pay('p1', 1, { status: 'diverifikasi' }) }).svc.reject('p1', 'salah catat ya', 'a1'),
    ).rejects.toThrow('sudah diproses');
  });
});

describe('SettlementsService.repay — pelunasan kekurangan setor', () => {
  it('mencatat pelunasan (negatif) dan mengunci baris teknisi', async () => {
    const { svc, tx } = setup({ saldo: 30000 });
    const r = await svc.repay({ technicianId: 't1', amount: 20000, note: 'transfer' }, 'a1');
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain('FROM users');
    expect(tx.technicianCashEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        technicianId: 't1',
        kind: 'pelunasan',
        amount: -20000,
        note: 'transfer',
        createdById: 'a1',
      }),
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'settlement.repay' });
    expect(r).toMatchObject({ saldoSebelum: 30000, saldoSesudah: 10000 });
  });

  it('tanpa saldo kurang atau melebihi saldo: ditolak', async () => {
    await expect(setup({ saldo: 0 }).svc.repay({ technicianId: 't1', amount: 1 }, 'a1')).rejects.toThrow('tidak punya');
    const { svc, tx } = setup({ saldo: 30000 });
    await expect(svc.repay({ technicianId: 't1', amount: 40000 }, 'a1')).rejects.toThrow('melebihi');
    expect(tx.technicianCashEntry.create).not.toHaveBeenCalled();
  });
});
