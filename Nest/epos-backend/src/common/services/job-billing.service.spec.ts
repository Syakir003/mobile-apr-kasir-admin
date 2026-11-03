import { JobBillingService, buildJobInvoiceLines, tagLinesWithUnit, unitInvoiceLabel } from './job-billing.service';

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

describe('nama unit di baris nota servis banyak AC', () => {
  it('unitInvoiceLabel: merk+model dan ruangan; QR dulu pakai ruangan, lalu kode QR', () => {
    expect(unitInvoiceLabel({ brand: 'Daikin', model: 'FTV25', roomLocation: 'Kamar Utama', barcodeValue: 'ACUNIT-1' })).toBe(
      'Daikin FTV25 (Kamar Utama)',
    );
    expect(unitInvoiceLabel({ brand: 'LG', model: null, roomLocation: null, barcodeValue: 'ACUNIT-1' })).toBe('LG');
    expect(unitInvoiceLabel({ brand: null, model: null, roomLocation: ' Kamar Anak ', barcodeValue: 'ACUNIT-2' })).toBe('Kamar Anak');
    expect(unitInvoiceLabel({ brand: null, model: null, roomLocation: '  ', barcodeValue: 'ACUNIT-3' })).toBe('ACUNIT-3');
  });

  it('tagLinesWithUnit: jasa/transport diberi nama unit, sparepart tidak; angka tetap', () => {
    const lines = buildJobInvoiceLines({
      services: [jasa('Cuci AC', 1, 100000)],
      spareparts: [part('Freon', 2, 50000)],
      transport: 100000,
      mode: 'individu',
    });
    const tagged = tagLinesWithUnit(lines, 'Daikin (Kamar 1)');
    expect(tagged.map((l) => l.name)).toEqual([
      'Cuci AC - Daikin (Kamar 1)',
      'Freon', // sparepart satu untuk seluruh job: tidak diberi nama unit
      'Biaya transport - Daikin (Kamar 1)',
    ]);
    expect(tagged.map((l) => [l.qty, l.unitPrice, l.lineTotal])).toEqual(lines.map((l) => [l.qty, l.unitPrice, l.lineTotal]));
  });
});

// rebuild() dengan tx tiruan: baris invoice yang ditulis memakai nama unit hanya kalau order punya lebih dari satu job.
function rebuildSetup(jobsInOrder: number, unit: Record<string, unknown> | null) {
  const created: any[] = [];
  const tx: any = {
    technicianJob: {
      findUnique: jest.fn(async () => ({
        id: 'j1',
        orderId: 'o1',
        status: 'sedang_dikerjakan',
        billingDerived: true,
        transportLevel: 0,
        transportMode: 'individu',
        serviceLines: [{ serviceId: null, name: 'Cuci AC', qty: 1, unitPrice: 100000 }],
        order: { invoiceId: 'inv1' },
        unit,
      })),
      count: jest.fn(async () => jobsInOrder),
    },
    materialRequest: { findMany: jest.fn(async () => []), updateMany: jest.fn() },
    $queryRaw: jest.fn(async () => [{ grand_total: '0', subtotal: '0', total_paid: '0', status: 'belum_dibayar' }]),
    invoiceItem: {
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(),
      create: jest.fn(async ({ data }: any) => created.push(data)),
    },
    invoice: { update: jest.fn() },
  };
  return { tx, created };
}

describe('JobBillingService.rebuild — nama unit pada baris invoice', () => {
  const unit = { brand: 'Daikin', model: 'FTV25', roomLocation: 'Kamar Utama', barcodeValue: 'ACUNIT-1' };

  it('order banyak unit: nama baris memuat unit, total tidak berubah', async () => {
    const { tx, created } = rebuildSetup(3, unit);
    const res = await new JobBillingService().rebuild(tx, 'j1');
    expect(created.map((c) => c.name)).toEqual(['Cuci AC - Daikin FTV25 (Kamar Utama)']);
    expect(created[0].lineTotal).toBe(100000);
    expect(res?.newTotal).toBe(100000);
    expect(tx.technicianJob.count).toHaveBeenCalledWith({ where: { orderId: 'o1' } });
  });

  it('order satu unit: nama baris apa adanya (perilaku lama)', async () => {
    const { tx, created } = rebuildSetup(1, unit);
    await new JobBillingService().rebuild(tx, 'j1');
    expect(created.map((c) => c.name)).toEqual(['Cuci AC']);
  });
});
