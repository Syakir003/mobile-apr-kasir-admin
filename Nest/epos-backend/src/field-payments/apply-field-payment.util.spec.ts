import { BadRequestException, NotFoundException } from '@nestjs/common';
import { applyFieldPaymentTx } from './apply-field-payment.util';

// Pelunasan resmi dari pembayaran lapangan: ManualPayment + status invoice dihitung ulang. Bila tagihan turun sesudah
// Tanda Terima terbit, hanya sebesar sisa yang diterapkan; kelebihannya dicatat (bukan utang teknisi).

const fp = {
  id: 'fp1', invoiceId: 'inv1', method: 'tunai', amount: 150000, proofUrl: '/uploads/payment-proofs/a.jpg',
  receiptNumber: 'TT-20261107-0012', recordedById: 't1',
};

function fakeTx(inv: { grand_total: string; total_paid: string; status: string } | null = { grand_total: '150000', total_paid: '0', status: 'belum_dibayar' }) {
  return {
    $queryRaw: jest.fn(async () => (inv ? [{ id: 'inv1', ...inv }] : [])),
    manualPayment: { create: jest.fn(async () => ({ id: 'mp1' })) },
    invoice: { update: jest.fn(async () => ({})) },
    fieldPayment: { update: jest.fn(async () => ({})) },
    technicianCashEntry: { create: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  } as any;
}

describe('applyFieldPaymentTx', () => {
  it('pas dengan sisa: ManualPayment dibuat, invoice lunas, pembayaran lapangan ditandai diverifikasi', async () => {
    const tx = fakeTx();
    const r = await applyFieldPaymentTx(tx, fp, 'a1', { settlementId: 's1' });
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    expect(tx.manualPayment.create).toHaveBeenCalledWith({
      data: {
        invoiceId: 'inv1', method: 'tunai', amount: 150000, note: 'Pembayaran lapangan TT-20261107-0012',
        proofUrl: '/uploads/payment-proofs/a.jpg', createdById: 'a1', shiftId: null,
      },
    });
    expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { totalPaid: 150000, status: 'lunas' } });
    const upd = tx.fieldPayment.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'fp1' });
    expect(upd.data).toMatchObject({ status: 'diverifikasi', manualPaymentId: 'mp1', verifiedById: 'a1', settlementId: 's1' });
    expect(upd.data.verifiedAt).toBeInstanceOf(Date);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'field_payment.verify', target: 'fp1' });
    expect(tx.technicianCashEntry.create).not.toHaveBeenCalled();
    expect(r).toMatchObject({ applied: 150000, excess: 0, invoiceStatus: 'lunas', manualPaymentId: 'mp1' });
  });

  it('sebagian: invoice jadi dp', async () => {
    const tx = fakeTx({ grand_total: '300000', total_paid: '0', status: 'belum_dibayar' });
    const r = await applyFieldPaymentTx(tx, fp, 'a1', {});
    expect(r.invoiceStatus).toBe('dp');
    expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { totalPaid: 150000, status: 'dp' } });
  });

  it('tagihan turun sesudah Tanda Terima: hanya sisa yang diterapkan, kelebihan dicatat sebagai kelebihan_pelanggan', async () => {
    const tx = fakeTx({ grand_total: '100000', total_paid: '0', status: 'belum_dibayar' });
    const r = await applyFieldPaymentTx(tx, fp, 'a1', { settlementId: 's1' });
    expect(tx.manualPayment.create.mock.calls[0][0].data).toMatchObject({ amount: 100000 });
    expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { totalPaid: 100000, status: 'lunas' } });
    expect(tx.technicianCashEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ technicianId: 't1', settlementId: 's1', kind: 'kelebihan_pelanggan', amount: 50000, createdById: 'a1' }),
    });
    expect(r).toMatchObject({ applied: 100000, excess: 50000 });
  });

  it('invoice sudah lunas lebih dulu (dibayar kasir): tidak ada ManualPayment, seluruhnya kelebihan', async () => {
    const tx = fakeTx({ grand_total: '150000', total_paid: '150000', status: 'lunas' });
    const r = await applyFieldPaymentTx(tx, fp, 'a1', {});
    expect(tx.manualPayment.create).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.technicianCashEntry.create.mock.calls[0][0].data).toMatchObject({ kind: 'kelebihan_pelanggan', amount: 150000 });
    expect(tx.fieldPayment.update.mock.calls[0][0].data).toMatchObject({ status: 'diverifikasi', manualPaymentId: null });
    expect(r).toMatchObject({ applied: 0, excess: 150000, manualPaymentId: null });
  });

  it('invoice batal / refund ditolak', async () => {
    await expect(applyFieldPaymentTx(fakeTx({ grand_total: '0', total_paid: '0', status: 'batal' }), fp, 'a1', {})).rejects.toThrow(BadRequestException);
    await expect(applyFieldPaymentTx(fakeTx({ grand_total: '1', total_paid: '0', status: 'refund' }), fp, 'a1', {})).rejects.toThrow('batal/refund');
  });

  it('invoice tidak ditemukan: 404', async () => {
    await expect(applyFieldPaymentTx(fakeTx(null), fp, 'a1', {})).rejects.toThrow(NotFoundException);
  });
});
