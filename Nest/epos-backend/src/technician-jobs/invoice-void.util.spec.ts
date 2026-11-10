import { BadRequestException } from '@nestjs/common';
import { assertLastJobCancelAllowed, voidInvoiceIfOrderCancelled } from './invoice-void.util';

// Invoice servis dibatalkan (void, bukan dihapus) hanya bila SEMUA job order dibatalkan, belum ada pembayaran, dan
// tidak ada tagihan tersisa. Pemasangan POS tidak disentuh (invoicenya penjualan).

const job = { id: 'j1', orderId: 'o1', type: 'perbaikan' };

type InvoiceRow = { total_paid: string; status: string; grand_total?: string };

function fakeTx(over: { invoiceId?: string | null; otherActive?: number; invoice?: InvoiceRow | null } = {}) {
  const invoiceId = over.invoiceId === undefined ? 'inv1' : over.invoiceId;
  const invoice = over.invoice === undefined ? { total_paid: '0', status: 'lunas' } : over.invoice;
  return {
    serviceOrder: { findUnique: jest.fn(async () => ({ invoiceId })) },
    technicianJob: { count: jest.fn(async () => over.otherActive ?? 0) },
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => (invoice ? [{ id: 'inv1', grand_total: '0', ...invoice }] : [])),
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

  it('job lain dihitung dengan filter: order yang sama, bukan job ini, status bukan dibatalkan (selesai tetap dihitung)', async () => {
    const tx = fakeTx();
    await voidInvoiceIfOrderCancelled(tx, job, 'a1');
    expect(tx.technicianJob.count).toHaveBeenCalledWith({
      where: { orderId: 'o1', id: { not: 'j1' }, status: { not: 'dibatalkan' } },
    });
  });

  it('pemasangan (invoice POS) tidak disentuh dan tidak mengunci apa pun', async () => {
    const tx = fakeTx();
    await expect(voidInvoiceIfOrderCancelled(tx, { ...job, type: 'pemasangan' }, 'a1')).resolves.toBe(false);
    expect(tx.serviceOrder.findUnique).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
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

  it('status refund: tidak dibatalkan', async () => {
    const tx = fakeTx({ invoice: { total_paid: '0', status: 'refund' } });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('baris invoice tidak ditemukan: tidak ada yang dibatalkan', async () => {
    const tx = fakeTx({ invoice: null });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('masih ada tagihan (grand_total > 0, mis. sparepart jalur penyesuaian lama): tidak dibatalkan supaya piutang tetap terlihat', async () => {
    const tx = fakeTx({ invoice: { total_paid: '0', status: 'belum_bayar', grand_total: '150000' } });
    await expect(voidInvoiceIfOrderCancelled(tx, job, 'a1')).resolves.toBe(false);
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('order dan job dikunci SEBELUM menghitung job terakhir', async () => {
    const tx = fakeTx();
    await voidInvoiceIfOrderCancelled(tx, job, 'a1');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2); // order, lalu semua job-nya
    const lockAt = tx.$executeRaw.mock.invocationCallOrder[0];
    const lastLockAt = tx.$executeRaw.mock.invocationCallOrder[1];
    const countAt = tx.technicianJob.count.mock.invocationCallOrder[0];
    expect(lockAt).toBeLessThan(countAt);
    expect(lastLockAt).toBeLessThan(countAt);
  });

  it('urutan kunci: order, job, baru invoice (sama dengan ServicePricingService.setWithin)', async () => {
    const tx = fakeTx();
    await voidInvoiceIfOrderCancelled(tx, job, 'a1');
    const sql = tx.$executeRaw.mock.calls.map((c: any[]) => (c[0] as string[]).join('?'));
    expect(sql[0]).toContain('service_orders');
    expect(sql[0]).toContain('FOR UPDATE');
    expect(sql[1]).toContain('technician_jobs');
    expect(sql[1]).toContain('ORDER BY id');
    expect(sql[1]).toContain('FOR UPDATE');
    expect(tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
  });

  it('invoice dikunci dengan FOR UPDATE', async () => {
    const tx = fakeTx();
    await voidInvoiceIfOrderCancelled(tx, job, 'a1');
    const sql = (tx.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('grand_total');
  });
});

describe('assertLastJobCancelAllowed', () => {
  it('job terakhir + invoice sudah punya pembayaran: ditolak (belum ada refund)', async () => {
    const tx = fakeTx({ invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, job)).rejects.toThrow(BadRequestException);
    await expect(assertLastJobCancelAllowed(tx, job)).rejects.toThrow('sudah punya pembayaran');
  });

  it('pesan galat menyebut job terakhir dan jalan keluarnya', async () => {
    const tx = fakeTx({ invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, job)).rejects.toThrow(
      'Invoice order ini sudah punya pembayaran, jadi job terakhirnya tidak bisa dibatalkan (sistem belum punya refund). Selesaikan job-nya, atau tunggu fitur refund.',
    );
  });

  it('masih ada job lain: lolos walau sudah ada pembayaran', async () => {
    const tx = fakeTx({ otherActive: 1, invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, job)).resolves.toBeUndefined();
  });

  it('belum ada pembayaran: lolos', async () => {
    await expect(assertLastJobCancelAllowed(fakeTx(), job)).resolves.toBeUndefined();
  });

  it('pemasangan tidak diperiksa dan tidak mengunci apa pun', async () => {
    const tx = fakeTx({ invoice: { total_paid: '50000', status: 'dp' } });
    await expect(assertLastJobCancelAllowed(tx, { ...job, type: 'pemasangan' })).resolves.toBeUndefined();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('order dan job dikunci SEBELUM menghitung job terakhir', async () => {
    const tx = fakeTx();
    await assertLastJobCancelAllowed(tx, job);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.technicianJob.count.mock.invocationCallOrder[0]);
  });
});
