import { ReportsService } from './reports.service';

// Modal yang belum diisi admin harus terlihat di laporan: angkanya belum final.

const range: [Date, Date] = [new Date('2026-11-01'), new Date('2026-11-30')];

function setup(firstQueryRows: unknown[], pending: { kind: string; refId: string }[]) {
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([]).mockResolvedValueOnce(firstQueryRows),
    itemCost: { findMany: jest.fn().mockResolvedValue(pending) },
    stockMovement: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return new ReportsService(prisma);
}

const sparepart = { id: 'sp1', name: 'Freon', category: null, unit: 'kg', stock: '5', batch_tracked: false };

const salesLine = {
  kind: 'sparepart', ref_id: 'sp1', name: 'Freon', qty_sold: '1', revenue: '100000', cogs: '0',
  baris_barang: '1', baris_tanpa_snapshot: '0', baris_tanpa_hpp_sama_sekali: '0',
  baris_modal_tak_dialokasikan: '0', modal_paket_maks: '0',
};

describe('Laporan stok — modal belum diisi', () => {
  it('baris ditandai bila barangnya punya modal kosong', async () => {
    const svc = setup([sparepart], [{ kind: 'sparepart', refId: 'sp1' }]);
    const { items } = await svc.stockMovements(...range, { kind: 'sparepart' });
    expect(items[0].modalBelumDiisi).toBe(true);
  });

  it('barang tanpa modal kosong tidak ditandai', async () => {
    const svc = setup([sparepart], [{ kind: 'product', refId: 'sp1' }]);
    const { items } = await svc.stockMovements(...range, { kind: 'sparepart' });
    expect(items[0].modalBelumDiisi).toBe(false);
  });
});

describe('Laba rugi — modal belum diisi', () => {
  it('catatan menyebut modal belum diisi', async () => {
    const svc = setup([salesLine], [{ kind: 'sparepart', refId: 'sp1' }]);
    const { detailPerItem } = await svc.profitLoss(...range);
    expect(detailPerItem[0].modalBelumDiisi).toBe(true);
    expect(detailPerItem[0].catatan).toContain('Ada modal belum diisi, angka belum final');
  });

  it('komponen paket instalasi dicocokkan sebagai sparepart', async () => {
    const svc = setup(
      [{ ...salesLine, kind: 'installation_package_item' }],
      [{ kind: 'sparepart', refId: 'sp1' }],
    );
    const { detailPerItem } = await svc.profitLoss(...range);
    expect(detailPerItem[0].modalBelumDiisi).toBe(true);
  });

  it('jasa tidak pernah ditandai', async () => {
    const svc = setup(
      [{ ...salesLine, kind: 'service' }],
      [{ kind: 'sparepart', refId: 'sp1' }],
    );
    const { detailPerItem } = await svc.profitLoss(...range);
    expect(detailPerItem[0].modalBelumDiisi).toBe(false);
  });
});
