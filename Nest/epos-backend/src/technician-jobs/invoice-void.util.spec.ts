import { BadRequestException } from '@nestjs/common';
import { assertLastJobCancelAllowed, voidInvoiceIfOrderCancelled } from './invoice-void.util';

// Invoice servis dibatalkan (void, bukan dihapus) hanya bila SEMUA job order dibatalkan dan belum ada pembayaran.
// Pemasangan POS tidak disentuh (invoicenya penjualan).

const job = { id: 'j1', orderId: 'o1', type: 'perbaikan' };

function fakeTx(over: { invoiceId?: string | null; otherActive?: number; invoice?: { total_paid: string; status: string } | null } = {}) {
  const invoiceId = over.invoiceId === undefined ? 'inv1' : over.invoiceId;
  const invoice = over.invoice === undefined ? { total_paid: '0', status: 'lunas' } : over.invoice;
  return {
    serviceOrder: { findUnique: jest.fn(async () => ({ invoiceId })) },
    technicianJob: { count: jest.fn(async () => over.otherActive ?? 0) },
    $queryRaw: jest.fn(async () => (invoice ? [{ id: 'inv1', ...invoice }] : [])),
    invoice: { update: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  } as any;
}

describe('voidInvoiceIfOrderCancelled', () => {
  it('semua job dibatalkan dan belum ada pembayaran: invoice jadi batal + audit', async () => {
    const tx = fakeTx();
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(true);
    expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { status: 'batal' } });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      actorUid: 'a1',
      action: 'invoice.void_on_cancel',
      target: 'inv1',
    });
  });

  it('masih ada job lain yang tidak dibatalkan: invoice dibiarkan', async () => {
    const tx = fakeTx({ otherActive: 1 });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('pemasangan (invoice POS) tidak disentuh', async () => {
    const tx = fakeTx();
    await expect(voidInvoiceIfOrderCancelled(tx, { ...job, type: 'pemasangan' }, 'a1')).resolves.toBe(false);
    expect(tx.serviceOrder.findUnique).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });

  it('order belum punya invoice: tidak ada yang dilakukan', async () => {
    const tx = fakeTx({ invoiceId: null });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });

  it('sudah ada pembayaran: tidak dibatalkan', async () => {
    const tx = fakeTx({ invoice: { total_paid: '50000', status: 'dp' } });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });

  it('sudah batal: tidak diproses dua kali', async () => {
    const tx = fakeTx({ invoice: { total_paid: '0', status: 'batal' } });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('assertLastJobCancelAllowed', () => {
  it('job terakhir + invoice sudah punya pembayaran: ditolak (belum ada refund)', async () => {
    const tx = fakeTx({ invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, job)).rejects.toThrow(BadRequestException);
    await expect(assertLastJobCancelAllowed(tx, job)).rejects.toThrow('sudah punya pembayaran');
  });

  it('masih ada job lain: lolos walau sudah ada pembayaran', async () => {
    const tx = fakeTx({ otherActive: 1, invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, job)).resolves.toBeUndefined();
  });

  it('belum ada pembayaran: lolos', async () => {
    await expect(assertLastJobCancelAllowed(fakeTx(), job)).resolves.toBeUndefined();
  });

  it('pemasangan tidak diperiksa', async () => {
    const tx = fakeTx({ invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, { ...job, type: 'pemasangan' })).resolves.toBeUndefined();
  });
});
