import { RemindersService } from './reminders.service';

// @nestjs/schedule ESM-only; @Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Pengingat WA ke satu nomor: member multi lokasi mendapat SATU pesan dengan tiap baris unit menyebut lokasinya.

const unit = (brand: string, room: string | null, locationName: string | null) => ({
  brand,
  model: 'X1',
  roomLocation: room,
  location: locationName ? { name: locationName } : null,
  indoorProduct: null,
  outdoorProduct: null,
});

function body(member: Record<string, unknown>, units: unknown[]) {
  const prisma: any = {
    member: { findUnique: jest.fn(async () => member) },
    memberAcUnit: { findMany: jest.fn(async () => units) },
    waReminderTemplate: { findUnique: jest.fn(async () => null) },
  };
  const svc = new RemindersService(prisma, {} as any, {} as any);
  return svc.buildBodyTx(prisma, 'm1', 'reminder_h3' as any, ['a', 'b', 'c'], new Date('2026-11-25T00:00:00Z'));
}

describe('RemindersService.buildBodyTx — lokasi unit', () => {
  it('member multi lokasi: baris menyebut lokasi + ruangan, dikelompokkan per lokasi (Lokasi 1 memakai nama utamanya)', async () => {
    const text = await body({ name: 'Bapak Ali', multiLocation: true, mainLocationName: 'Kantor Lama' }, [
      unit('Panasonic', 'Lantai 2', 'Kantor Baru'),
      unit('Daikin', 'Ruang Rapat', null), // Lokasi 1
      unit('Sharp', null, 'Kantor Baru'),
    ]);
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toEqual([
      '- Sharp X1 (Kantor Baru)',
      '- Panasonic X1 (Kantor Baru - Lantai 2)',
      '- Daikin X1 (Kantor Lama - Ruang Rapat)',
    ]);
  });

  it('member multi lokasi tanpa nama Lokasi 1: memakai "Lokasi 1"', async () => {
    const text = await body({ name: 'Bapak Ali', multiLocation: true, mainLocationName: null }, [unit('Daikin', null, null)]);
    expect(text).toContain('- Daikin X1 (Lokasi 1)');
  });

  it('member biasa: perilaku lama, hanya ruangan', async () => {
    const text = await body({ name: 'Bu Sari', multiLocation: false, mainLocationName: null }, [
      unit('Daikin', 'Kamar Utama', null),
      unit('Sharp', null, null),
    ]);
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toEqual(['- Daikin X1 (Kamar Utama)', '- Sharp X1']);
  });
});
