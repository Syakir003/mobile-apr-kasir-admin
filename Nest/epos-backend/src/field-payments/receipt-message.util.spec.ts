import { buildReceiptMessage } from './receipt-message.util';

describe('buildReceiptMessage — Tanda Terima WA', () => {
  const base = {
    receiptNumber: 'TT-20261107-0012',
    amount: 150000,
    method: 'tunai' as const,
    customerName: 'Bu Sari',
    serviceSummary: 'Cuci AC (2)',
    paidAt: new Date('2026-11-07T03:00:00Z'),
    technicianName: 'Budi',
  };

  it('pendek: empat baris, tanpa tautan', () => {
    expect(buildReceiptMessage(base)).toBe(
      [
        'Tanda Terima TT-20261107-0012',
        'AYUB AC menerima Rp 150.000 (Tunai) dari Bu Sari',
        'untuk Cuci AC (2), 7 Nov 2026. Teknisi: Budi.',
        'Faktur menyusul dari admin.',
      ].join('\n'),
    );
  });

  it('metode non-tunai memakai labelnya', () => {
    expect(buildReceiptMessage({ ...base, method: 'qris' })).toContain('(QRIS)');
  });

  it('tanggal memakai zona WIB (UTC 18:30 = hari berikutnya di WIB)', () => {
    expect(buildReceiptMessage({ ...base, paidAt: new Date('2026-11-07T18:30:00Z') })).toContain('8 Nov 2026');
  });
});
