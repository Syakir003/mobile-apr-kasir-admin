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
