import { buildStockReportRow, orderPairedRows } from './stock-report-row.util';

describe('buildStockReportRow (Point 4 - Laporan Stok)', () => {
  const baseItem = {
    itemKind: 'product' as const,
    refId: 'p1',
    name: 'AC Split 1PK Indoor',
    unit: 'unit',
    category: 'AC',
  };

  it('semua angka default 0 kalau agg kosong/null', () => {
    const row = buildStockReportRow(baseItem, {});
    expect(row).toMatchObject({
      itemKind: 'product',
      refId: 'p1',
      name: 'AC Split 1PK Indoor',
      unit: 'unit',
      category: 'AC',
      stokAwal: 0,
      stokMasuk: 0,
      stokKeluar: 0,
      sisaStok: 0,
      modalTersisa: 0,
      omzetTerjual: 0,
      untungTerjual: 0,
    });
    expect(row.unitGabungan).toBeUndefined();
  });

  it('parse angka dari string (gotcha Decimal via $queryRaw) & itung untungTerjual = omzet - cogs', () => {
    const row = buildStockReportRow(baseItem, {
      opening: '5',
      masuk: '10',
      keluar: '3',
      sisa: '12',
      modal: '1200000',
      omzet: '3000000',
      cogs: '2000000',
    });
    expect(row.stokAwal).toBe(5);
    expect(row.stokMasuk).toBe(10);
    expect(row.stokKeluar).toBe(3);
    expect(row.sisaStok).toBe(12);
    expect(row.modalTersisa).toBe(1200000);
    expect(row.omzetTerjual).toBe(3000000);
    expect(row.untungTerjual).toBe(1000000);
  });

  it('nambahin unitGabungan kalau ada pairedItem, sisaUnit = MIN(sisa indoor, sisa outdoor)', () => {
    const row = buildStockReportRow(
      baseItem,
      { sisa: '4' },
      {
        pairedItem: { itemKind: 'product', refId: 'p2', name: 'AC Split 1PK Outdoor', unit: 'unit', category: 'AC' },
        pairedSisa: 7,
        unitAgg: { masuk: '2', keluar: '1' },
      },
    );
    expect(row.unitGabungan).toEqual({
      namaPasangan: 'AC Split 1PK Outdoor',
      stokMasuk: 2,
      stokKeluar: 1,
      sisaStok: 4, // MIN(4, 7)
    });
  });

  it('unitAgg kosong (belum pernah ada aksi Unit Lengkap) tetap kebentuk unitGabungan dgn angka 0', () => {
    const row = buildStockReportRow(
      baseItem,
      { sisa: '9' },
      {
        pairedItem: { itemKind: 'product', refId: 'p2', name: 'AC Split 1PK Outdoor', unit: 'unit', category: 'AC' },
        pairedSisa: 2,
      },
    );
    expect(row.unitGabungan).toEqual({
      namaPasangan: 'AC Split 1PK Outdoor',
      stokMasuk: 0,
      stokKeluar: 0,
      sisaStok: 2, // MIN(9, 2)
    });
  });
});

describe('orderPairedRows (Paket AC Split)', () => {
  const row = (refId: string) => buildStockReportRow({ itemKind: 'product', refId, name: refId, unit: 'unit', category: null }, {});

  it('Outdoor dipindah persis ke bawah Indoor pasangannya, sekali aja', () => {
    const rows = [row('a-outdoor'), row('b-lain'), row('c-indoor'), row('d-lain')];
    const result = orderPairedRows(rows, new Map([['c-indoor', 'a-outdoor']]));
    expect(result.map((r) => r.refId)).toEqual(['b-lain', 'c-indoor', 'a-outdoor', 'd-lain']);
  });

  it('Outdoor yang Indoor-nya gak ada di laporan tetap di posisinya', () => {
    const rows = [row('a-outdoor'), row('b-lain')];
    const result = orderPairedRows(rows, new Map([['c-indoor', 'a-outdoor']]));
    expect(result.map((r) => r.refId)).toEqual(['a-outdoor', 'b-lain']);
  });
});
