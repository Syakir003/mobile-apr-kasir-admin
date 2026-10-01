import { BadRequestException } from '@nestjs/common';
import { StockLockingService } from './stock-locking.service';

// Beda dari fakeTx lama (1 hasil query dipakai buat SEMUA panggilan) —
// lockAndDeduct(kind='product') sekarang manggil $queryRawUnsafe 3x (query
// produk, query batch berstok buat MAX buyPrice, query pilih unit FIFO) —
// butuh hasil BERBEDA per panggilan berurutan.
function fakeTxSequence(queryResults: unknown[][]) {
  const queryMock = jest.fn();
  queryResults.forEach((r) => queryMock.mockResolvedValueOnce(r));
  return {
    $queryRawUnsafe: queryMock,
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  } as any;
}

describe('StockLockingService.lockAndDeduct (kind=product)', () => {
  it('FIFO pilih unit dari batch TERTUA dulu, harga jual dari Product.sellPrice, buyPrice = MAX batch berstok', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [
        { id: 'batch-lama', buy_price: '2900000' },
        { id: 'batch-baru', buy_price: '3100000' },
      ],
      [
        { id: 'unit-1', item_cost_id: 'batch-lama' },
        { id: 'unit-2', item_cost_id: 'batch-lama' },
        { id: 'unit-3', item_cost_id: 'batch-baru' },
      ],
    ]);

    const result = await service.lockAndDeduct(tx, 'product', 'produk-1', 3);

    expect(result).toEqual({
      name: 'AC Split 1PK',
      unit: 'unit',
      unitPrice: 3200000,
      buyPrice: 3100000, // MAX(2900000, 3100000) — bukan cuma batch yang kena FIFO
      batchDeductions: [
        { itemCostId: 'batch-lama', qty: 2 },
        { itemCostId: 'batch-baru', qty: 1 },
      ],
      reservedUnitIds: ['unit-1', 'unit-2', 'unit-3'],
    });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE stock_units SET status = 'reserved'"),
      ['unit-1', 'unit-2', 'unit-3'],
    );
  });

  it('buyPrice tetap MAX dari SEMUA batch berstok walau qty cuma abisin batch pertama', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [
        { id: 'batch-a', buy_price: '2900000' },
        { id: 'batch-b', buy_price: '3100000' },
      ],
      [{ id: 'unit-1', item_cost_id: 'batch-a' }],
    ]);

    const result = await service.lockAndDeduct(tx, 'product', 'produk-1', 1);

    expect(result.buyPrice).toBe(3100000);
    expect(result.batchDeductions).toEqual([{ itemCostId: 'batch-a', qty: 1 }]);
    expect(result.reservedUnitIds).toEqual(['unit-1']);
  });

  it('lempar BadRequestException kalau produk gak ketemu', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([[]]);
    await expect(service.lockAndDeduct(tx, 'product', 'produk-x', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lempar BadRequestException kalau produk nonaktif', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([[{ name: 'AC Split 1PK', active: false, sell_price: '3200000' }]]);
    await expect(service.lockAndDeduct(tx, 'product', 'produk-1', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lempar BadRequestException kalau gak ada batch berstok sama sekali', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [],
    ]);
    await expect(service.lockAndDeduct(tx, 'product', 'produk-1', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lempar BadRequestException kalau unit tersedia lebih sedikit dari qty diminta', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'AC Split 1PK', active: true, sell_price: '3200000' }],
      [{ id: 'batch-1', buy_price: '2900000' }],
      [{ id: 'unit-1', item_cost_id: 'batch-1' }],
    ]);
    await expect(service.lockAndDeduct(tx, 'product', 'produk-1', 5)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('StockLockingService.lockAndDeduct (kind=sparepart)', () => {
  it('flat (batchTracked=false) — potong langsung kolom spareparts.stock, unit dari row asli (bukan hardcode pcs)', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'Freon R32', active: true, unit: 'kg', batch_tracked: false, sell_price: '85000', stock: '10' }],
    ]);

    const result = await service.lockAndDeduct(tx, 'sparepart', 'sp-1', 3);

    expect(result).toEqual({
      name: 'Freon R32',
      unit: 'kg',
      unitPrice: 85000,
      buyPrice: null,
      qtyMultiplier: 1,
      saleKind: null,
    });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE spareparts SET stock = stock - $1'),
      3,
      'sp-1',
    );
  });

  it('flat — lempar BadRequestException kalau stok kolom flat gak cukup', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'Freon R32', active: true, unit: 'kg', batch_tracked: false, sell_price: '85000', stock: '2' }],
    ]);
    await expect(service.lockAndDeduct(tx, 'sparepart', 'sp-1', 3)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('batch-tracked — FIFO lintas item_costs, unit dari row sparepart, buyPrice = MAX batch berstok, mirror spareparts.stock ikut kepotong', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'Pipa AC 1/4', active: true, unit: 'meter', batch_tracked: true, sell_price: '25000', stock: '15' }],
      [
        { id: 'roll-lama', stock: '4', buy_price: '18000' },
        { id: 'roll-baru', stock: '11', buy_price: '19000' },
      ],
    ]);

    const result = await service.lockAndDeduct(tx, 'sparepart', 'sp-pipa', 6);

    expect(result).toEqual({
      name: 'Pipa AC 1/4',
      unit: 'meter',
      unitPrice: 25000,
      buyPrice: 19000, // MAX(18000, 19000)
      batchDeductions: [
        { itemCostId: 'roll-lama', qty: 4 },
        { itemCostId: 'roll-baru', qty: 2 },
      ],
      qtyMultiplier: 1,
      saleKind: null,
    });
    // 2 UPDATE item_costs (per roll kepotong) + 1 UPDATE spareparts (mirror).
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE item_costs SET stock = stock - $1'),
      4,
      'roll-lama',
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE item_costs SET stock = stock - $1'),
      2,
      'roll-baru',
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE spareparts SET stock = stock - $1'),
      6,
      'sp-pipa',
    );
  });

  it('batch-tracked — lempar BadRequestException kalau total stok semua roll gak cukup', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [{ name: 'Pipa AC 1/4', active: true, unit: 'meter', batch_tracked: true, sell_price: '25000', stock: '4' }],
      [{ id: 'roll-1', stock: '4', buy_price: '18000' }],
    ]);
    await expect(service.lockAndDeduct(tx, 'sparepart', 'sp-pipa', 10)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lempar BadRequestException kalau sparepart gak ketemu / nonaktif', async () => {
    const service = new StockLockingService();
    const txNotFound = fakeTxSequence([[]]);
    await expect(service.lockAndDeduct(txNotFound, 'sparepart', 'sp-x', 1)).rejects.toThrow(
      BadRequestException,
    );

    const txInactive = fakeTxSequence([
      [{ name: 'Freon R32', active: false, unit: 'kg', batch_tracked: false, sell_price: '85000', stock: '10' }],
    ]);
    await expect(service.lockAndDeduct(txInactive, 'sparepart', 'sp-1', 1)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('StockLockingService.lockAndDeduct (sparepart utuh/eceran)', () => {
  const konversiRow = {
    name: 'Baut Klem', active: true, unit: 'pcs', batch_tracked: false, sell_price: '500', stock: '250',
    tracking_mode: 'konversi', pack_unit: 'dus', pack_size: '100', sell_price_pack: '40000',
  };
  const gabunganRow = {
    name: 'Pipa 1/4', active: true, unit: 'm', batch_tracked: true, sell_price: '70000', stock: '37',
    tracking_mode: 'gabungan', pack_unit: 'roll', pack_size: '15', sell_price_pack: '1000000',
  };

  it('konversi utuh — qty dus dikali packSize, harga utuh, unit = packUnit', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([[konversiRow]]);
    const r = await service.lockAndDeduct(tx, 'sparepart', 'sp', 2, 'utuh');
    expect(r).toMatchObject({ unit: 'dus', unitPrice: 40000, qtyMultiplier: 100, saleKind: 'utuh' });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('UPDATE spareparts'), 200, 'sp');
  });

  it('konversi utuh — stok satuan kecil kurang => ditolak; qty pecahan ditolak', async () => {
    const service = new StockLockingService();
    await expect(service.lockAndDeduct(fakeTxSequence([[konversiRow]]), 'sparepart', 'sp', 3, 'utuh')).rejects.toThrow('tidak cukup');
    await expect(service.lockAndDeduct(fakeTxSequence([[konversiRow]]), 'sparepart', 'sp', 1.5, 'utuh')).rejects.toThrow('bilangan bulat');
  });

  it('konversi eceran — harga eceran, potong qty apa adanya', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([[konversiRow]]);
    const r = await service.lockAndDeduct(tx, 'sparepart', 'sp', 30, 'eceran');
    expect(r).toMatchObject({ unit: 'pcs', unitPrice: 500, qtyMultiplier: 1 });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('UPDATE spareparts'), 30, 'sp');
  });

  it('mode biasa/gulungan tidak bisa dijual utuh', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([[{ ...konversiRow, tracking_mode: 'biasa', pack_unit: null, pack_size: null }]]);
    await expect(service.lockAndDeduct(tx, 'sparepart', 'sp', 1, 'utuh')).rejects.toThrow('tidak bisa dijual utuh');
  });

  it('gabungan utuh — ambil roll penuh, habis sekaligus, query minta stock = packSize', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [gabunganRow],
      [
        { id: 'r1', stock: '15', buy_price: '60000' },
        { id: 'r2', stock: '15', buy_price: '62000' },
      ],
    ]);
    const r = await service.lockAndDeduct(tx, 'sparepart', 'sp', 1, 'utuh');
    expect(r.batchDeductions).toEqual([{ itemCostId: 'r1', qty: 15 }]);
    expect(r).toMatchObject({ unit: 'roll', unitPrice: 1000000, qtyMultiplier: 15 });
    expect(tx.$queryRawUnsafe.mock.calls[1][0]).toContain('AND stock = $2::numeric');
    expect(tx.$queryRawUnsafe.mock.calls[1].slice(1)).toEqual(['sp', 15]);
  });

  it('gabungan utuh — roll penuh kurang dari diminta => ditolak dengan pesan jelas', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([[gabunganRow], [{ id: 'r1', stock: '15', buy_price: '60000' }]]);
    await expect(service.lockAndDeduct(tx, 'sparepart', 'sp', 2, 'utuh')).rejects.toThrow('utuh tidak cukup');
  });

  it('gabungan eceran — urut roll terbuka dulu (query ORDER BY stock = packSize), bisa lintas roll', async () => {
    const service = new StockLockingService();
    const tx = fakeTxSequence([
      [gabunganRow],
      [
        { id: 'buka', stock: '7', buy_price: '60000' },
        { id: 'penuh', stock: '15', buy_price: '62000' },
      ],
    ]);
    const r = await service.lockAndDeduct(tx, 'sparepart', 'sp', 10, 'eceran');
    expect(r.batchDeductions).toEqual([
      { itemCostId: 'buka', qty: 7 },
      { itemCostId: 'penuh', qty: 3 },
    ]);
    expect(tx.$queryRawUnsafe.mock.calls[1][0]).toContain('CASE WHEN stock = $2::numeric THEN 1 ELSE 0 END');
  });
});
