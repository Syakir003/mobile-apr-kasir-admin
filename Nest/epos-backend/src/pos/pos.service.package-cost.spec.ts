import { PosService } from './pos.service';

// @nestjs/schedule berformat ESM, tidak bisa dimuat jest CommonJS; checkout tidak memakainya.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined, CronExpression: {} }));

// Modal komponen paket instalasi harus dibaca SESUDAH baris stok dikunci.
// Kalau dibaca sebelumnya, admin yang sedang mengoreksi harga bisa commit di
// antaranya dan invoice menyimpan angka lama selamanya.

function setup(locked: Record<string, unknown>) {
  const events: string[] = [];
  const invoiceLines: Record<string, any>[] = [];
  const overrides: Record<string, (args: any) => unknown> = {
    'member.findUnique': () => ({ id: 'm1', priceTier: 'retail', phone: '081200000001' }),
    'installationPackage.findUnique': () => ({
      id: 'pk', active: true,
      items: [{ sparepartId: 'sp', name: 'Pipa', unit: 'm', qty: 3, extraPricePerUnit: 1000 }],
    }),
    'service.findUnique': () => ({ name: 'Pasang', active: true, basePrice: 100000 }),
    'itemCost.findFirst': () => {
      events.push('cost');
      return { buyPrice: 500 };
    },
    'invoiceItem.create': ({ data }) => {
      invoiceLines.push(data);
      return data;
    },
  };
  const tx: any = new Proxy({ $queryRaw: async () => [], $queryRawUnsafe: async () => [] } as any, {
    get: (target, model: string) =>
      target[model] ??
      new Proxy({}, {
        get: (_, method: string) => async (args: any) => {
          const handler = overrides[`${model}.${method}`];
          if (handler) return handler(args);
          if (method === 'findMany') return [];
          if (method.startsWith('find')) return null;
          return { id: 'x', number: 'INV-1', ...args?.data };
        },
      }),
  });
  const locking = {
    lockAndDeduct: async () => {
      events.push('lock');
      return { name: 'Pipa', unit: 'm', unitPrice: 1000, ...locked };
    },
  };
  const service = new PosService(
    { $transaction: (fn: (t: unknown) => unknown) => fn(tx) } as any,
    locking as any,
    { nextSeq: async () => 1, dateKey: () => '20261128' } as any,
    {} as any,
    { createForInstallation: async () => ({ id: 'u', barcodeValue: 'B', roomLocation: null }) } as any,
    { createForOrder: async () => ({ id: 'j', technicianId: null }) } as any,
    {} as any,
    {} as any,
  );
  const run = () =>
    service.checkout(
      {
        customer: { name: 'Budi', memberId: 'm1', phone: '081200000001' },
        items: [{ kind: 'service', refId: 'svc', qty: 1 }],
        installations: [{ itemIndexes: [], packageId: 'pk' }],
      },
      'kasir',
    );
  const packageSnapshot = () =>
    invoiceLines.find((l) => l.kind === 'installation_package_item')?.buyPriceSnapshot;
  return { run, events, packageSnapshot };
}

describe('PosService.checkout — modal komponen paket instalasi', () => {
  it('sparepart biasa: dibaca sesudah stok dikunci', async () => {
    const { run, events, packageSnapshot } = setup({ buyPrice: null });
    await expect(run()).resolves.toMatchObject({ status: 'ok' });
    expect(events).toEqual(['lock', 'cost']);
    expect(packageSnapshot()).toBe(500);
  });

  it('sparepart gulungan: pakai modal gulungan yang diambil, bukan baris sembarang', async () => {
    const { run, events, packageSnapshot } = setup({
      buyPrice: 700,
      batchDeductions: [{ itemCostId: 'r1', qty: 3 }],
    });
    await run();
    expect(events).toEqual(['lock']);
    expect(packageSnapshot()).toBe(700);
  });
});
