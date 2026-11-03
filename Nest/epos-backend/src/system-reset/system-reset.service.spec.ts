import { SystemResetService } from './system-reset.service';
import { RESET_CONFIRM_TEXT, ResetScope } from './dto/reset-database.dto';

// tx tiruan: setiap model mencatat urutan deleteMany() dipanggil. Postgres menolak hapus induk sebelum anaknya
// (FK RESTRICT), jadi urutan inilah yang dijaga.
function setup() {
  const order: string[] = [];
  const tx: any = new Proxy(
    {},
    {
      get: (_t, model: string) => ({
        deleteMany: async () => {
          order.push(model);
          return { count: 0 };
        },
        updateMany: async () => ({ count: 0 }),
        create: async () => ({ at: new Date() }),
      }),
    },
  );
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { svc: new SystemResetService(prisma), order };
}

const run = (scope: ResetScope) => {
  const { svc, order } = setup();
  return svc.reset({ scope, confirmText: RESET_CONFIRM_TEXT[scope] }, 'admin1').then(() => order);
};

describe('SystemResetService — urutan hapus aman foreign key', () => {
  it('transaksi_pelanggan: koreksi data AC dihapus SEBELUM unit AC, dan unit AC sebelum member', async () => {
    const order = await run('transaksi_pelanggan');
    expect(order).toContain('acUnitCorrection');
    expect(order.indexOf('acUnitCorrection')).toBeLessThan(order.indexOf('memberAcUnit'));
    expect(order.indexOf('memberAcUnit')).toBeLessThan(order.indexOf('member'));
  });

  it.each(['transaksi', 'transaksi_pelanggan', 'total'] as ResetScope[])(
    '%s: riwayat alih tugas dihapus SEBELUM job teknisi',
    async (scope) => {
      const order = await run(scope);
      expect(order).toContain('jobHandover');
      expect(order.indexOf('jobHandover')).toBeLessThan(order.indexOf('technicianJob'));
    },
  );

  it('transaksi saja: pelanggan, unit AC, dan koreksi tidak disentuh', async () => {
    const order = await run('transaksi');
    expect(order).not.toContain('acUnitCorrection');
    expect(order).not.toContain('memberAcUnit');
    expect(order).not.toContain('member');
    expect(order).not.toContain('stockUnit');
  });

  it('total: unit stok dihapus SEBELUM batch (itemCost) dan produk', async () => {
    const order = await run('total');
    expect(order).toContain('stockUnit');
    expect(order.indexOf('stockUnit')).toBeLessThan(order.indexOf('itemCost'));
    expect(order.indexOf('stockUnit')).toBeLessThan(order.indexOf('product'));
    expect(order.indexOf('acUnitCorrection')).toBeLessThan(order.indexOf('memberAcUnit'));
  });

  it('transaksi_pelanggan: unit stok (master katalog) tidak ikut terhapus', async () => {
    expect(await run('transaksi_pelanggan')).not.toContain('stockUnit');
  });

  it('teks konfirmasi salah ditolak sebelum menyentuh database', async () => {
    const { svc } = setup();
    await expect(svc.reset({ scope: 'total', confirmText: 'salah' }, 'a1')).rejects.toThrow('Teks konfirmasi salah');
  });
});
