import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { SparepartsController } from './spareparts.controller';

// Gudang boleh mendaftarkan barang baru yang LANGSUNG bisa dijual, tetapi hanya
// harga Ritel; stok & modal lewat Barang Masuk, admin diberi tahu.

const dto = {
  name: 'Freon R32', unit: 'kg', sellPrice: 90000, stock: 25,
  priceInstaller: 80000, priceReseller: 70000, pricePackInstaller: 1, pricePackReseller: 2,
};

function setup() {
  const spareparts = { create: jest.fn(async (d) => ({ id: 's1', name: d.name })) };
  const notifications = { notifyRoles: jest.fn() };
  const controller = new SparepartsController(spareparts as any, notifications as any);
  return { controller, spareparts, notifications };
}

const gudang = { sub: 'g1', role: 'gudang' } as any;
const admin = { sub: 'a1', role: 'admin' } as any;

describe('POST /spareparts', () => {
  it('admin & gudang boleh menambah; mengubah tetap admin saja', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SparepartsController.prototype.create)).toEqual(['admin', 'gudang']);
    expect(Reflect.getMetadata(ROLES_KEY, SparepartsController.prototype.update)).toEqual(['admin']);
  });

  it('gudang: harga installer/reseller diabaikan, stok awal dipaksa 0, admin diberi tahu', async () => {
    const { controller, spareparts, notifications } = setup();
    await controller.create({ ...dto }, gudang);
    const [sent, actor] = spareparts.create.mock.calls[0] as any[];
    expect(sent).toEqual({ name: 'Freon R32', unit: 'kg', sellPrice: 90000, stock: 0 });
    expect(actor).toBe('g1');
    expect((spareparts.create.mock.calls[0] as any[])[2]).toEqual({ pending: false });
    expect(notifications.notifyRoles).toHaveBeenCalledWith(['admin'], expect.objectContaining({
      type: 'sparepart_baru',
      body: expect.stringContaining('Freon R32'),
    }));
  });

  it('gudang: harga jual kosong disimpan menunggu harga (tidak aktif)', async () => {
    const { controller, spareparts, notifications } = setup();
    await controller.create({ ...dto, sellPrice: 0 }, gudang);
    expect((spareparts.create.mock.calls[0] as any[])[2]).toEqual({ pending: true });
    expect(notifications.notifyRoles).toHaveBeenCalledWith(['admin'], expect.objectContaining({
      body: expect.stringContaining('menunggu harga'),
    }));
  });

  it('gudang: kemasan tanpa harga utuh juga menunggu harga', async () => {
    const { controller, spareparts } = setup();
    await controller.create({ ...dto, trackingMode: 'gabungan', sellPricePack: undefined }, gudang);
    expect((spareparts.create.mock.calls[0] as any[])[2]).toEqual({ pending: true });
  });

  it('admin: apa adanya, tanpa notifikasi', async () => {
    const { controller, spareparts, notifications } = setup();
    await controller.create({ ...dto }, admin);
    expect((spareparts.create.mock.calls[0] as any[])[0]).toEqual(dto);
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });
});
