import { BadRequestException } from '@nestjs/common';
import { assertPaymentRecordedOrExplained } from './payment-gate.util';

// Order bayar_di_lokasi: teknisi baru boleh Ajukan Selesai bila pembayaran sudah dicatat ATAU ada alasan tertulis
// (mis. pelanggan belum bisa membayar). Admin, pemasangan, komplain, order ditagih_admin, dan tagihan Rp 0 tidak dihalangi.

const job = { id: 'j1', orderId: 'o1', type: 'cuci', complaintOfJobId: null as string | null };

function fakeTx(over: { paymentMode?: string; invoiceId?: string | null; recorded?: number; grand?: number; paid?: number } = {}) {
  return {
    serviceOrder: {
      findUnique: jest.fn(async () => ({ paymentMode: over.paymentMode ?? 'bayar_di_lokasi', invoiceId: over.invoiceId === undefined ? 'inv1' : over.invoiceId })),
      update: jest.fn(async () => ({})),
    },
    fieldPayment: { count: jest.fn(async () => over.recorded ?? 0) },
    invoice: { findUnique: jest.fn(async () => ({ grandTotal: over.grand ?? 150000, totalPaid: over.paid ?? 0 })) },
  } as any;
}

describe('assertPaymentRecordedOrExplained', () => {
  it('belum ada pembayaran dan tanpa alasan: ditolak', async () => {
    await expect(assertPaymentRecordedOrExplained(fakeTx(), job, 'teknisi')).rejects.toThrow(BadRequestException);
    await expect(assertPaymentRecordedOrExplained(fakeTx(), job, 'teknisi', '  ab ')).rejects.toThrow('catat pembayaran dulu');
  });

  it('alasan tertulis (min. 5 karakter) diterima dan disimpan di order', async () => {
    const tx = fakeTx();
    await assertPaymentRecordedOrExplained(tx, job, 'teknisi', ' Pelanggan belum gajian, bayar besok ');
    expect(tx.serviceOrder.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { unpaidReason: 'Pelanggan belum gajian, bayar besok' } });
  });

  it('pembayaran lapangan sudah tercatat (selain yang ditolak): lolos tanpa alasan', async () => {
    const tx = fakeTx({ recorded: 1 });
    await expect(assertPaymentRecordedOrExplained(tx, job, 'teknisi')).resolves.toBeUndefined();
    expect(tx.fieldPayment.count).toHaveBeenCalledWith({ where: { orderId: 'o1', status: { not: 'ditolak' } } });
  });

  it.each([
    ['admin', { role: 'admin' as const, job, tx: fakeTx() }],
    ['pemasangan', { role: 'teknisi' as const, job: { ...job, type: 'pemasangan' }, tx: fakeTx() }],
    ['komplain', { role: 'teknisi' as const, job: { ...job, complaintOfJobId: 'j0' }, tx: fakeTx() }],
    ['order ditagih admin', { role: 'teknisi' as const, job, tx: fakeTx({ paymentMode: 'ditagih_admin' }) }],
    ['order belum punya invoice', { role: 'teknisi' as const, job, tx: fakeTx({ invoiceId: null }) }],
    ['tagihan Rp 0 (garansi/gratis)', { role: 'teknisi' as const, job, tx: fakeTx({ grand: 0 }) }],
    ['tagihan sudah lunas', { role: 'teknisi' as const, job, tx: fakeTx({ paid: 150000 }) }],
  ])('tidak menghalangi: %s', async (_n, c) => {
    await expect(assertPaymentRecordedOrExplained(c.tx, c.job, c.role)).resolves.toBeUndefined();
  });
});
