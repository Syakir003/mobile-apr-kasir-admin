import { buildInvoiceWaValues, wibDateParts } from './invoice-wa.util';

const base = {
  number: 'INV-20261018-0001',
  createdAt: new Date('2026-10-22T06:39:00.000Z'), // 13.39 WIB
  subtotal: '1260000',
  discount: '0',
  taxPercent: '0',
  taxAmount: '0',
  transportFee: '0',
  grandTotal: '1260000',
  totalPaid: '0',
  status: 'belum_dibayar',
  items: [
    {
      kind: 'service',
      name: 'Bongkar Pasang AC',
      unit: 'jasa',
      qty: '1',
      unitPrice: '550000',
      lineTotal: '550000',
    },
    {
      kind: 'sparepart',
      name: 'Bracket Outdoor',
      unit: 'set',
      qty: '2.00',
      unitPrice: '65000',
      lineTotal: '130000',
    },
  ],
  adjustments: [] as { reason: string | null; requestId: string | null }[],
};

describe('wibDateParts', () => {
  it('memakai zona WIB, bukan zona proses', () => {
    expect(wibDateParts(new Date('2026-10-22T06:39:00.000Z'))).toEqual({
      tanggal: '22 Oktober 2026',
      waktu: '13.39 WIB',
    });
  });
  it('lewat tengah malam WIB pindah hari', () => {
    expect(wibDateParts(new Date('2026-10-21T18:05:00.000Z')).tanggal).toBe(
      '22 Oktober 2026',
    );
  });
});

describe('buildInvoiceWaValues', () => {
  it('daftar barang bergaya nota dengan jumlah, satuan, harga, dan total', () => {
    const v = buildInvoiceWaValues(base);
    expect(v.item).toBe(
      '✅ Bongkar Pasang AC\n   1 jasa x Rp550.000 = Rp550.000\n✅ Bracket Outdoor\n   2 set x Rp65.000 = Rp130.000',
    );
  });

  it('belum dibayar: sisa tagihan penuh dan status belum lunas', () => {
    const v = buildInvoiceWaValues(base);
    expect(v.pembayaran).toBe('Sisa tagihan : *Rp1.260.000*');
    expect(v.status).toBe('Belum lunas');
    expect(v.rincian).toBe(
      'Total tagihan : Rp1.260.000\n*Grand total : Rp1.260.000*',
    );
  });

  it('DP: tampil dibayar dan sisa', () => {
    const v = buildInvoiceWaValues({
      ...base,
      status: 'dp',
      totalPaid: '500000',
    });
    expect(v.pembayaran).toBe(
      'Dibayar : Rp500.000\nSisa tagihan : *Rp760.000*',
    );
    expect(v.status).toBe('DP (belum lunas)');
  });

  it('lunas: tanpa sisa tagihan', () => {
    const v = buildInvoiceWaValues({
      ...base,
      status: 'lunas',
      totalPaid: '1260000',
    });
    expect(v.pembayaran).toBe('*Lunas*, dibayar Rp1.260.000');
    expect(v.status).toBe('Lunas');
  });

  it('rincian memuat diskon, pajak, transport, dan tambahan; angkanya menutup ke grand total', () => {
    const v = buildInvoiceWaValues({
      ...base,
      subtotal: '1000000',
      discount: '100000',
      taxPercent: '11',
      taxAmount: '99000',
      transportFee: '50000',
      grandTotal: '1049000',
      adjustments: [{ reason: 'Voucher', requestId: null }],
    });
    expect(v.rincian).toBe(
      [
        'Total tagihan : Rp1.000.000',
        'Diskon (Voucher) : - Rp100.000',
        'Pajak (11%) : Rp99.000',
        'Biaya transport : Rp50.000',
        '*Grand total : Rp1.049.000*',
      ].join('\n'),
    );
  });

  it('selisih dari penyesuaian sparepart tampil sebagai Tambahan sparepart', () => {
    const v = buildInvoiceWaValues({
      ...base,
      subtotal: '1000000',
      grandTotal: '1200000',
    });
    expect(v.rincian).toContain('Tambahan sparepart : Rp200.000');
  });

  it('unit paket tanpa harga ditandai termasuk paket', () => {
    const v = buildInvoiceWaValues({
      ...base,
      items: [
        {
          kind: 'product',
          name: 'Outdoor Daikin',
          unit: 'unit',
          qty: '1',
          unitPrice: '0',
          lineTotal: '0',
        },
      ],
    });
    expect(v.item).toContain('Outdoor Daikin (termasuk paket)');
  });
});
