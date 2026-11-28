import { Prisma } from '@prisma/client';
import { readFileSync } from 'fs';
import { firstValueFrom, of } from 'rxjs';
import { HidePricesInterceptor, PRICE_KEYS, hidePrices } from './hide-prices.interceptor';

const run = (role: string, body: unknown) => {
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  };
  return firstValueFrom(new HidePricesInterceptor().intercept(context as never, { handle: () => of(body) }));
};

const sparepart = {
  id: 's1', name: 'Kabel', unit: 'm', stock: new Prisma.Decimal(50), active: false, trackingMode: 'gabungan',
  sellPrice: new Prisma.Decimal(5000), sellPricePack: null, priceInstaller: 4000, priceReseller: null,
  createdAt: new Date('2026-11-28T00:00:00Z'),
};

describe('HidePricesInterceptor: gudang tidak boleh menerima harga', () => {
  it('membuang semua harga (juga yang bersarang) tanpa merusak angka stok & tanggal', async () => {
    const out = (await run('gudang', {
      items: [{ name: 'AC', qty: 2, unitPrice: 100, lineTotal: 200, product: { sellPrice: 1, buyPrice: 2, active: true } }],
      invoice: { number: 'INV-1', grandTotal: 200, totalPaid: 0 },
      warnings: [{ name: 'x', buyPrice: 9, sellPrice: 8, effectivePrice: 8 }],
      batches: [{ itemCostId: 'c1', qtyRemaining: 3, buyPrice: 7 }],
      sparepart,
    })) as any;
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/"(sellPrice|sellPricePack|buyPrice|priceInstaller|unitPrice|lineTotal|grandTotal|totalPaid|effectivePrice)"/);
    expect(out.items[0].qty).toBe(2);
    expect(out.batches[0]).toEqual({ itemCostId: 'c1', qtyRemaining: 3 });
    expect(out.invoice).toEqual({ number: 'INV-1' });
    expect(String(out.sparepart.stock)).toBe('50');
    expect(out.sparepart.createdAt).toBeInstanceOf(Date);
  });

  it('menggantinya dengan penanda menunggu harga (aturan sama dengan web)', () => {
    const pending = (extra: object) => (hidePrices({ ...sparepart, ...extra }) as any).pendingPrice;
    expect(pending({})).toBe(true); // kemasan tanpa harga utuh
    expect(pending({ sellPricePack: 200000 })).toBe(false);
    expect(pending({ trackingMode: 'biasa' })).toBe(false);
    expect(pending({ trackingMode: 'biasa', sellPrice: 0 })).toBe(true);
    expect(pending({ trackingMode: 'biasa', sellPrice: 0, active: true })).toBe(false);
    expect(pending({ trackingMode: undefined, sellPrice: 0, acRole: 'outdoor' })).toBe(false);
  });

  it('setiap kolom Decimal di skema: ada di daftar harga atau jelas bukan uang', () => {
    const NOT_MONEY = ['lat', 'latitude', 'lng', 'longitude', 'minStock', 'packSize', 'pk', 'qty', 'qtyChange',
      'qtyUsed', 'stock', 'taxPercent', 'qtyRemaining', 'qtyReceived', 'length', 'lengthRemaining', 'distanceKm'];
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const columns = [...schema.matchAll(/^\s+(\w+)\s+Decimal\??(\s|$)/gm)].map((m) => m[1]);
    expect(columns.length).toBeGreaterThan(10);
    expect([...new Set(columns)].filter((c) => !PRICE_KEYS.has(c) && !NOT_MONEY.includes(c))).toEqual([]);
  });

  it('admin, kasir, teknisi: apa adanya', async () => {
    for (const role of ['admin', 'kasir', 'teknisi']) {
      await expect(run(role, sparepart)).resolves.toBe(sparepart);
    }
  });
});
