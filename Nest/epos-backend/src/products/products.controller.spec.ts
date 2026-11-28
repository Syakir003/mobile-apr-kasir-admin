import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ProductsController } from './products.controller';

// Gudang boleh mendaftarkan AC baru yang LANGSUNG bisa dijual: harga Ritel saja.

function setup() {
  const products = { create: jest.fn(async (d) => ({ id: 'p1', name: d.name })) };
  const notifications = { notifyRoles: jest.fn() };
  const controller = new ProductsController(products as any, notifications as any);
  return { controller, products, notifications };
}

const gudang = { sub: 'g1', role: 'gudang' } as any;
const dto = { name: 'AC Sharp 1 PK', sellPrice: 4000000, priceInstaller: 1, priceReseller: 2 };

describe('POST /products', () => {
  it('admin & gudang boleh menambah & mengubah (gudang dibatasi di service)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ProductsController.prototype.create)).toEqual(['admin', 'gudang']);
    expect(Reflect.getMetadata(ROLES_KEY, ProductsController.prototype.update)).toEqual(['admin', 'gudang']);
  });

  it('gudang: harga installer/reseller diabaikan, admin diberi tahu', async () => {
    const { controller, products, notifications } = setup();
    await controller.create({ ...dto }, gudang);
    expect(products.create).toHaveBeenCalledWith({ name: 'AC Sharp 1 PK', sellPrice: 4000000 }, 'g1', { pending: false });
    expect(notifications.notifyRoles).toHaveBeenCalledWith(['admin'], expect.objectContaining({
      type: 'produk_baru',
      body: expect.stringContaining('AC Sharp 1 PK'),
    }));
  });

  it('gudang: harga jual kosong disimpan menunggu harga (tidak aktif)', async () => {
    const { controller, products, notifications } = setup();
    await controller.create({ ...dto, sellPrice: 0 }, gudang);
    expect((products.create.mock.calls[0] as any[])[2]).toEqual({ pending: true });
    expect(notifications.notifyRoles).toHaveBeenCalledWith(['admin'], expect.objectContaining({
      body: expect.stringContaining('menunggu harga'),
    }));
  });

  it('gudang: Outdoor dari paket boleh Rp0 (harga ada di paket)', async () => {
    const { controller, products } = setup();
    await controller.create({ name: 'Outdoor', sellPrice: 0, acRole: 'outdoor' }, gudang);
    expect((products.create.mock.calls[0] as any[])[2]).toEqual({ pending: false });
  });

  it('admin: apa adanya, tanpa notifikasi', async () => {
    const { controller, products, notifications } = setup();
    await controller.create({ ...dto }, { sub: 'a1', role: 'admin' } as any);
    expect(products.create).toHaveBeenCalledWith(dto, 'a1');
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });
});
