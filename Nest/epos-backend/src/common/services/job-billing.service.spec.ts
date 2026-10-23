import { buildJobInvoiceLines } from './job-billing.service';

const jasa = (name: string, qty: number, unitPrice: number) => ({ refId: null, name, unit: 'jasa', qty, unitPrice });
const part = (name: string, qty: number, unitPrice: number) => ({ refId: 'sp', name, unit: 'kg', qty, unitPrice });

describe('buildJobInvoiceLines', () => {
  it('tanpa transport: jasa + sparepart apa adanya', () => {
    const lines = buildJobInvoiceLines({
      services: [jasa('Cuci', 1, 100000)],
      spareparts: [part('Freon', 2, 50000)],
      transport: 0,
      mode: 'dibagi',
    });
    expect(lines.map((l) => [l.kind, l.lineTotal])).toEqual([
      ['service', 100000],
      ['sparepart', 100000],
    ]);
  });

  it('transport individu: baris Biaya transport sendiri, harga baris lain tidak berubah', () => {
    const lines = buildJobInvoiceLines({
      services: [jasa('Cuci', 1, 100000)],
      spareparts: [part('Freon', 2, 50000)],
      transport: 200000,
      mode: 'individu',
    });
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatchObject({ name: 'Biaya transport', qty: 1, unitPrice: 200000, lineTotal: 200000 });
    expect(lines[0].lineTotal).toBe(100000);
    expect(lines[1].lineTotal).toBe(100000);
  });

  it('transport dibagi: tanpa baris transport, dibagi sama rata per baris, total tetap', () => {
    const lines = buildJobInvoiceLines({
      services: [jasa('Cuci', 1, 100000)],
      spareparts: [part('Freon', 2, 50000)],
      transport: 200000,
      mode: 'dibagi',
    });
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.lineTotal)).toEqual([200000, 200000]); // +100.000 tiap baris
    expect(lines[1].unitPrice).toBe(100000); // 200.000 / 2 kg
    expect(lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(100000 + 100000 + 200000);
  });

  it('transport dibagi: sisa pembulatan masuk ke baris pertama', () => {
    const lines = buildJobInvoiceLines({
      services: [jasa('A', 1, 10000), jasa('B', 1, 10000)],
      spareparts: [part('C', 1, 10000)],
      transport: 100000,
      mode: 'dibagi',
    });
    expect(lines.map((l) => l.lineTotal)).toEqual([43334, 43333, 43333]); // 10.000 + 33.333 (+1 sisa di baris pertama)
    expect(lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(30000 + 100000);
  });

  it('dibagi dengan satu baris: seluruh transport masuk ke baris itu', () => {
    const lines = buildJobInvoiceLines({ services: [jasa('Cuci', 1, 50000)], spareparts: [], transport: 300000, mode: 'dibagi' });
    expect(lines).toHaveLength(1);
    expect(lines[0].lineTotal).toBe(350000);
  });

  it('dibagi tanpa baris sama sekali: jatuh ke baris transport individu', () => {
    const lines = buildJobInvoiceLines({ services: [], spareparts: [], transport: 100000, mode: 'dibagi' });
    expect(lines).toHaveLength(1);
    expect(lines[0].name).toBe('Biaya transport');
  });
});
