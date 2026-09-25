import { MembersService } from './members.service';

/**
 * Regresi bug: `members.phone` di DB Supabase itu NOT NULL + UNIQUE beneran
 * (`members_phone_key`, dicek langsung ke DB — bukan partial index yang
 * ngecualiin ''). Sebelum fix ini, walk-in KEDUA yang gak ngasih HP valid
 * nabrak unique violation pas checkout (member pertama udah "mengunci" '').
 * Lihat komentar generateNoPhoneSentinel() di members.service.ts.
 */
describe('MembersService — sentinel phone buat walk-in tanpa HP', () => {
  const service = new MembersService({} as any, {} as any);
  const generate = () => (service as any).generateNoPhoneSentinel() as string;

  it('gak pernah string kosong (biar gak nabrak unique constraint members.phone)', () => {
    expect(generate()).not.toBe('');
  });

  it('2 kali generate -> 2 nilai BEDA (walk-in kedua gak ke-reuse jadi member pertama)', () => {
    const a = generate();
    const b = generate();
    expect(a).not.toBe(b);
  });

  it('hasilnya NOL digit — waPhone() bakal balikin "" (member walk-in ini otomatis ke-skip dari pengiriman WA, gak ada risiko nge-hit Fonnte dgn nomor ngarang)', () => {
    for (let i = 0; i < 20; i++) {
      const sentinel = generate();
      expect(sentinel.replace(/\D/g, '')).toBe('');
    }
  });
});

describe('MembersService.findOrCreate — 2 walk-in beda tanpa HP valid', () => {
  it('tidak di-reuse jadi 1 member yang sama (dua create() terpisah, phone masing2 beda)', async () => {
    const created: { name: string; phone: string }[] = [];
    const tx = {
      member: {
        create: jest.fn(({ data }: any) => {
          created.push({ name: data.name, phone: data.phone });
          return Promise.resolve({ id: `id-${created.length}`, ...data });
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    };
    const service = new MembersService({} as any, {} as any);

    // Placeholder yang di-strip normalizePhone() jadi '' — kasus nyata di
    // POS: kasir ngetik "-" buat walk-in yang gak mau ngasih HP.
    const first = await service.findOrCreate(tx as any, 'Walk-in A', '-');
    const second = await service.findOrCreate(tx as any, 'Walk-in B', '()');

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(true);
    expect(created).toHaveLength(2);
    expect(created[0].phone).not.toBe(created[1].phone);
    expect(created[0].phone).not.toBe('');
    expect(created[1].phone).not.toBe('');
    // findFirst (jalur lookup-by-phone) SAMA SEKALI gak dipanggil buat phone
    // kosong — phone kosong tidak pernah jadi kunci pencarian/reuse.
    expect(tx.member.findFirst).not.toHaveBeenCalled();
  });
});
