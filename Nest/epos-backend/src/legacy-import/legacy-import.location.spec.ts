import { LegacyImportService } from './legacy-import.service';

// @nestjs/schedule ESM-only; terseret lewat invoices -> reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Input Data Lampau untuk member MULTI LOKASI: tiap unit memilih lokasinya ('utama' = Lokasi 1 atau id lokasi tambahan).

const multiMember = {
  id: 'm1',
  name: 'Bapak Ali',
  phone: '+62812',
  address: 'Jl. Lama 1',
  mapsUrl: null,
  multiLocation: true,
  mainLocationName: 'Kantor Lama',
};
const kantorBaru = { id: 'L2', memberId: 'm1', name: 'Kantor Baru', address: 'Jl. Baru 9', mapsUrl: null };

function setup(opts: { member?: Record<string, unknown>; newMember?: boolean } = {}) {
  const member = { ...multiMember, ...opts.member };
  const tx: any = {
    member: {
      findUnique: jest.fn(async () => member),
      update: jest.fn(async ({ data }: any) => ({ ...member, ...data })),
    },
    memberLocation: { findFirst: jest.fn(async () => kantorBaru) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const members: any = {
    findOrCreate: jest.fn(async () => ({ member: { ...member, multiLocation: false, mainLocationName: null }, isNew: true })),
  };
  let n = 0;
  const acUnits: any = {
    createLegacy: jest.fn(async (_tx: unknown, _memberId: string, u: any) => ({
      id: `u${++n}`,
      barcodeValue: `ACUNIT-${n}`,
      status: u.mode === 'qr_dulu' ? 'menunggu_data' : 'aktif',
      brand: u.brand ?? null,
      model: u.model ?? null,
      roomLocation: u.roomLocation ?? null,
      locationId: u.locationId ?? null,
    })),
  };
  const svc = new LegacyImportService(prisma, members, acUnits, {} as any);
  return { svc, tx, acUnits, members };
}

const unit = (extra: Record<string, unknown> = {}) => ({ mode: 'diketahui' as const, brand: 'Daikin', ...extra });

describe('LegacyImportService.import — member multi lokasi', () => {
  it('tiap unit WAJIB memilih lokasinya', async () => {
    const { svc, acUnits } = setup();
    await expect(svc.import({ member: { memberId: 'm1' }, units: [unit()] } as any, 'a1')).rejects.toThrow(/Pilih lokasi/);
    expect(acUnits.createLegacy).not.toHaveBeenCalled();
  });

  it('unit dengan lokasi berbeda dalam satu kali simpan: masing-masing ikut lokasinya', async () => {
    const { svc, tx, acUnits } = setup();
    const res = await svc.import(
      { member: { memberId: 'm1' }, units: [unit({ locationId: 'utama' }), unit({ locationId: 'L2' })] } as any,
      'a1',
    );
    expect(acUnits.createLegacy).toHaveBeenNthCalledWith(1, tx, 'm1', expect.objectContaining({ locationId: null }));
    expect(acUnits.createLegacy).toHaveBeenNthCalledWith(2, tx, 'm1', expect.objectContaining({ locationId: 'L2' }));
    expect(res.units.map((u: any) => u.locationId)).toEqual([null, 'L2']);
  });

  it('lokasi milik member lain / tidak ada: ditolak', async () => {
    const { svc, tx } = setup();
    tx.memberLocation.findFirst.mockResolvedValue(null);
    await expect(
      svc.import({ member: { memberId: 'm1' }, units: [unit({ locationId: 'L-lain' })] } as any, 'a1'),
    ).rejects.toThrow(/bukan milik member ini/);
  });

  it('member tanpa multi lokasi: tidak boleh mengirim lokasi, unit tanpa lokasi (perilaku lama)', async () => {
    const { svc, acUnits } = setup({ member: { multiLocation: false } });
    await expect(
      svc.import({ member: { memberId: 'm1' }, units: [unit({ locationId: 'utama' })] } as any, 'a1'),
    ).rejects.toThrow(/belum memakai multi lokasi/);
    await svc.import({ member: { memberId: 'm1' }, units: [unit()] } as any, 'a1');
    expect(acUnits.createLegacy).toHaveBeenLastCalledWith(expect.anything(), 'm1', expect.objectContaining({ locationId: null }));
  });

  it('member BARU dengan saklar multi lokasi: saklar menyala, unit tanpa pilihan otomatis Lokasi 1', async () => {
    const { svc, tx, acUnits } = setup();
    const res = await svc.import(
      {
        member: { name: 'Bapak Ali', phone: '0812', address: 'Jl. Lama 1', multiLocation: true, mainLocationName: ' Kantor Lama ' },
        units: [unit()],
      } as any,
      'a1',
    );
    expect(tx.member.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { multiLocation: true, mainLocationName: 'Kantor Lama' },
    });
    expect(acUnits.createLegacy).toHaveBeenCalledWith(tx, 'm1', expect.objectContaining({ locationId: null }));
    expect(res.memberIsNew).toBe(true);
  });
});
