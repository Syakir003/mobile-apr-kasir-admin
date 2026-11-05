import { NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

// RemindersService menarik @nestjs/schedule (ESM) yang tidak bisa dimuat jest; tidak dipakai di sini.
jest.mock('../reminders/reminders.service', () => ({
  RemindersService: class {},
}));

describe('struk publik', () => {
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const service = new InvoicesService(
    { invoice: { findUnique, updateMany } } as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

  beforeEach(() => jest.resetAllMocks());

  it('menolak token berformat salah tanpa menyentuh database', async () => {
    await expect(service.findPublicReceipt('pendek')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.findPublicReceipt('a'.repeat(31) + '/'),
    ).rejects.toThrow(NotFoundException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('404 untuk token yang tidak ada, dan select tidak memuat HP/alamat/catatan/harga beli', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.findPublicReceipt('A'.repeat(32))).rejects.toThrow(
      NotFoundException,
    );
    const [{ select }] = findUnique.mock.calls[0] as [
      { select: Record<string, unknown> },
    ];
    for (const f of ['customerPhone', 'notes', 'member', 'memberId', 'id'])
      expect(select).not.toHaveProperty(f);
    expect(JSON.stringify(select)).not.toContain('buyPrice');
  });

  it('token dibuat sekali lalu dipakai ulang', async () => {
    findUnique
      .mockResolvedValueOnce({ publicToken: null })
      .mockResolvedValueOnce({ publicToken: 'T'.repeat(32) });
    updateMany.mockResolvedValue({ count: 0 }); // kalah balapan: pakai token pemenang
    expect(await service.ensurePublicToken('inv-1')).toBe('T'.repeat(32));
    findUnique.mockResolvedValueOnce({ publicToken: 'X'.repeat(32) });
    expect(await service.ensurePublicToken('inv-1')).toBe('X'.repeat(32));
  });
});

describe('struk publik - ringkasan pengerjaan & foto', () => {
  const invoiceFindUnique = jest.fn();
  const orderFindMany = jest.fn();
  const photoFindFirst = jest.fn();
  const service = new InvoicesService(
    {
      invoice: { findUnique: invoiceFindUnique },
      serviceOrder: { findMany: orderFindMany },
      jobFindingPhoto: { findFirst: photoFindFirst },
    } as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  const token = 'A'.repeat(32);
  const unit = (room: string) => ({ brand: 'Daikin', model: 'SK', roomLocation: room, barcodeValue: 'ACUNIT-1' });
  const job = (status: string, room: string, photos: { id: string; kind: string }[] = []) => ({
    status,
    unit: unit(room),
    findings: photos.length ? [{ id: `f-${room}`, title: 'Cuci AC', photos }] : [],
  });

  beforeEach(() => {
    jest.resetAllMocks();
    invoiceFindUnique.mockResolvedValue({ number: 'INV-1', items: [], adjustments: [] });
  });

  it('nota tanpa pekerjaan teknisi (penjualan biasa): work = null', async () => {
    orderFindMany.mockResolvedValue([]);
    expect((await service.findPublicReceipt(token)).work).toBeNull();
    expect(orderFindMany.mock.calls[0][0].where).toEqual({ invoice: { publicToken: token } });
  });

  it('semua unit selesai: 100% Selesai, foto sebelum/sesudah dikelompokkan per temuan (hanya id foto)', async () => {
    orderFindMany.mockResolvedValue([
      { units: [job('selesai', 'Kamar', [{ id: 'p1', kind: 'sebelum' }, { id: 'p2', kind: 'sesudah' }, { id: 'p3', kind: 'sesudah' }])] },
    ]);
    const { work } = await service.findPublicReceipt(token);
    expect(work).toMatchObject({ progress: 100, label: 'Selesai', done: true });
    expect(work!.gallery).toEqual([{ id: 'f-Kamar', title: 'Cuci AC', unit: null, before: ['p1'], after: ['p2', 'p3'] }]);
    expect(JSON.stringify(work)).not.toContain('/uploads');
  });

  it('banyak unit: status tetap 100% Selesai walau ada unit belum rampung; nama unit ikut di foto', async () => {
    orderFindMany.mockResolvedValue([
      { units: [job('selesai', 'Kamar 1', [{ id: 'a', kind: 'sebelum' }]), job('sedang_dikerjakan', 'Kamar 2')] },
    ]);
    const { work } = await service.findPublicReceipt(token);
    expect(work).toMatchObject({ progress: 100, label: 'Selesai', done: true });
    expect(work!.gallery[0].unit).toBe('Daikin SK (Kamar 1)');
    expect(orderFindMany.mock.calls[0][0].select.units.where).toEqual({ status: { not: 'dibatalkan' } });
  });

  it('job belum dimulai pun tetap tampil 100% Selesai (status tidak mengikuti tahap job)', async () => {
    orderFindMany.mockResolvedValue([{ units: [job('assigned', 'Kamar')] }]);
    expect((await service.findPublicReceipt(token)).work).toMatchObject({ progress: 100, label: 'Selesai', done: true });
  });

  it('foto: hanya milik nota dengan token ini; token/id berformat salah atau foto lain = 404', async () => {
    photoFindFirst.mockResolvedValue({ path: '/uploads/findings/x.jpg' });
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(await service.findPublicReceiptPhotoPath(token, id)).toBe('/uploads/findings/x.jpg');
    expect(photoFindFirst.mock.calls[0][0].where).toEqual({
      id,
      finding: { job: { order: { invoice: { publicToken: token } } } },
    });
    photoFindFirst.mockResolvedValue(null);
    await expect(service.findPublicReceiptPhotoPath(token, id)).rejects.toThrow(NotFoundException);
    photoFindFirst.mockClear();
    await expect(service.findPublicReceiptPhotoPath('pendek', id)).rejects.toThrow(NotFoundException);
    await expect(service.findPublicReceiptPhotoPath(token, '../etc/passwd')).rejects.toThrow(NotFoundException);
    expect(photoFindFirst).not.toHaveBeenCalled();
  });
});
