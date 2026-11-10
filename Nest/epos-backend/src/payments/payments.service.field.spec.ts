import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

// Uang yang sudah dicatat teknisi di lokasi (belum diverifikasi) tidak boleh dibayar lagi lewat kasir/admin.

function setup(activeSum: number | null) {
  const tx: any = {
    $queryRaw: jest.fn(async () => [{ id: 'inv1', grand_total: '150000', total_paid: '0', status: 'belum_dibayar' }]),
    fieldPayment: { aggregate: jest.fn(async () => ({ _sum: { amount: activeSum } })) },
    manualPayment: { create: jest.fn(async () => ({ id: 'mp1' })) },
    invoice: { update: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const shifts: any = { findOpenShiftForKasir: jest.fn(async () => null) };
  return { svc: new PaymentsService(prisma, shifts), tx };
}

describe('PaymentsService.record — penjaga pembayaran lapangan', () => {
  it('tanpa pembayaran lapangan aktif: perilaku lama', async () => {
    const { svc, tx } = setup(null);
    await expect(svc.record('inv1', { method: 'tunai', amount: 150000 }, 'k1')).resolves.toMatchObject({ status: 'lunas' });
    expect(tx.fieldPayment.aggregate.mock.calls[0][0].where).toMatchObject({
      invoiceId: 'inv1',
      status: { in: ['dipegang_teknisi', 'menunggu_cocok'] },
    });
  });

  it('sebagian sudah dicatat teknisi: nominal melebihi sisa efektif ditolak dengan penjelasan', async () => {
    const { svc, tx } = setup(100000);
    const p = svc.record('inv1', { method: 'tunai', amount: 60000 }, 'k1');
    await expect(p).rejects.toThrow(BadRequestException);
    await expect(svc.record('inv1', { method: 'tunai', amount: 60000 }, 'k1')).rejects.toThrow('menunggu setoran');
    expect(tx.manualPayment.create).not.toHaveBeenCalled();
  });

  it('nominal yang muat di sisa efektif tetap boleh', async () => {
    const { svc } = setup(100000);
    await expect(svc.record('inv1', { method: 'tunai', amount: 50000 }, 'k1')).resolves.toMatchObject({ status: 'dp' });
  });
});
