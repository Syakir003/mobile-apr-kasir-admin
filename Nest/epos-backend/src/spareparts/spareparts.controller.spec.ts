import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { SparepartsController } from './spareparts.controller';

// Gudang boleh mendaftarkan barang baru yang LANGSUNG bisa dijual, tetapi hanya
// harga Ritel; stok & modal lewat Barang Masuk, admin diberi tahu.

const dto = {
  name: 'Freon R32', unit: 'kg', sellPrice: 90000, stock: 25,
  priceInstaller: 80000, priceReseller: 70000, pricePackInstaller: 1, pricePackReseller: 2,
};

function setup() {
  const spareparts = {
    create: jest.fn(async (d) => ({ id: 's1', name: d.name })),
    update: jest.fn(),
    editIdentity: jest.fn(),
  };
  const notifications = { notifyRoles: jest.fn() };
  const controller = new SparepartsController(spareparts as any, notifications as any);
  return { controller, spareparts, notifications };
}

const gudang = { sub: 'g1', role: 'gudang' } as any;
const admin = { sub: 'a1', role: 'admin' } as any;

describe('POST /spareparts', () => {
  it('admin & gudang boleh menambah & mengubah (gudang dibatasi di bawah)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SparepartsController.prototype.create)).toEqual(['admin', 'gudang']);
    expect(Reflect.getMetadata(ROLES_KEY, SparepartsController.prototype.update)).toEqual(['admin', 'gudang']);
  });

  it('gudang: semua harga yang dikirim diabaikan, selalu menunggu harga, stok awal 0', async () => {
    const { controller, spareparts, notifications } = setup();
    await controller.create({ ...dto }, gudang);
    const [sent, actor] = spareparts.create.mock.calls[0] as any[];
    expect(sent).toEqual({ name: 'Freon R32', unit: 'kg', sellPrice: 0, stock: 0 });
    expect(actor).toBe('g1');
    expect((spareparts.create.mock.calls[0] as any[])[2]).toEqual({ pending: true });
    expect(notifications.notifyRoles).toHaveBeenCalledWith(['admin'], expect.objectContaining({
      type: 'sparepart_baru',
      body: expect.stringContaining('Freon R32'),
    }));
  });

  it('admin: apa adanya, tanpa notifikasi', async () => {
    const { controller, spareparts, notifications } = setup();
    await controller.create({ ...dto }, admin);
    expect((spareparts.create.mock.calls[0] as any[])[0]).toEqual(dto);
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });
});

describe('PATCH /spareparts', () => {
  it('gudang tidak pernah lewat jalur ubah penuh milik admin', async () => {
    const { controller, spareparts } = setup();
    await controller.update('s1', { sellPrice: 1, active: true }, gudang);
    expect(spareparts.update).not.toHaveBeenCalled();
    expect(spareparts.editIdentity).toHaveBeenCalledWith('s1', { sellPrice: 1, active: true }, 'g1');
  });

  it('admin: ubah penuh', async () => {
    const { controller, spareparts } = setup();
    await controller.update('s1', { sellPrice: 1 }, admin);
    expect(spareparts.update).toHaveBeenCalledWith('s1', { sellPrice: 1 }, 'a1');
    expect(spareparts.editIdentity).not.toHaveBeenCalled();
  });
});
