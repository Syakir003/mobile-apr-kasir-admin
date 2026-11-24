import { BadRequestException } from '@nestjs/common';
import {
  assertUnitAtLocation,
  jobWorkLocation,
  mainLocationName,
  resolveLocationChoice,
} from './member-location.util';

// Multi lokasi member: Lokasi 1 = alamat utama member (locationId NULL), lokasi lain = baris member_locations.

const multi = {
  id: 'm1',
  multiLocation: true,
  mainLocationName: 'Kantor Lama',
  address: 'Jl. Lama 1',
  mapsUrl: 'https://maps.example/lama',
};
const plain = { ...multi, multiLocation: false, mainLocationName: null };
const dbWith = (loc: unknown) => ({ memberLocation: { findFirst: jest.fn(async () => loc) } }) as any;

describe('mainLocationName', () => {
  it('memakai nama yang diberikan, bawaan "Lokasi 1"', () => {
    expect(mainLocationName({ mainLocationName: 'Kantor Lama' })).toBe('Kantor Lama');
    expect(mainLocationName({ mainLocationName: null })).toBe('Lokasi 1');
    expect(mainLocationName({ mainLocationName: '   ' })).toBe('Lokasi 1');
  });
});

describe('resolveLocationChoice', () => {
  it('member tanpa multi lokasi: tanpa pilihan = tanpa lokasi (perilaku lama)', async () => {
    const r = await resolveLocationChoice(dbWith(null), plain, undefined);
    expect(r).toEqual({ locationId: null, name: null, address: null, mapsUrl: null });
  });

  it('member tanpa multi lokasi: mengirim pilihan lokasi ditolak', async () => {
    await expect(resolveLocationChoice(dbWith(null), plain, 'utama')).rejects.toThrow(/belum memakai multi lokasi/);
  });

  it('member multi lokasi: pilihan WAJIB', async () => {
    await expect(resolveLocationChoice(dbWith(null), multi, undefined)).rejects.toThrow(/Pilih lokasi/);
    await expect(resolveLocationChoice(dbWith(null), multi, '   ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it("'utama' = Lokasi 1: locationId null, nama + alamat + link member", async () => {
    const db = dbWith(null);
    const r = await resolveLocationChoice(db, multi, 'utama');
    expect(r).toEqual({ locationId: null, name: 'Kantor Lama', address: 'Jl. Lama 1', mapsUrl: 'https://maps.example/lama' });
    expect(db.memberLocation.findFirst).not.toHaveBeenCalled();
  });

  it('id lokasi tambahan: dicari hanya di lokasi milik member itu', async () => {
    const db = dbWith({ id: 'L2', name: 'Kantor Baru', address: 'Jl. Baru 9', mapsUrl: null });
    const r = await resolveLocationChoice(db, multi, 'L2');
    expect(db.memberLocation.findFirst).toHaveBeenCalledWith({ where: { id: 'L2', memberId: 'm1' } });
    expect(r).toEqual({ locationId: 'L2', name: 'Kantor Baru', address: 'Jl. Baru 9', mapsUrl: null });
  });

  it('lokasi milik member lain / tidak ada: ditolak', async () => {
    await expect(resolveLocationChoice(dbWith(null), multi, 'L-lain')).rejects.toThrow(/bukan milik member ini/);
  });

  it('fallbackToMain (member yang baru diaktifkan): tanpa pilihan = Lokasi 1', async () => {
    const r = await resolveLocationChoice(dbWith(null), multi, undefined, { fallbackToMain: true });
    expect(r.locationId).toBeNull();
    expect(r.name).toBe('Kantor Lama');
  });
});

describe('jobWorkLocation', () => {
  it('Lokasi 1 dan member biasa: ikut alamat member (null/null)', () => {
    expect(jobWorkLocation({ locationId: null, name: 'Kantor Lama', address: 'Jl. Lama 1', mapsUrl: 'x' })).toEqual({
      workAddress: null,
      workMapsUrl: null,
    });
  });

  it('lokasi tambahan: alamat + link lokasi itu jadi lokasi kerja job', () => {
    expect(jobWorkLocation({ locationId: 'L2', name: 'Kantor Baru', address: ' Jl. Baru 9 ', mapsUrl: 'https://m/b' })).toEqual({
      workAddress: 'Jl. Baru 9',
      workMapsUrl: 'https://m/b',
    });
  });

  it('lokasi tambahan tanpa alamat: hanya link', () => {
    expect(jobWorkLocation({ locationId: 'L2', name: 'Kantor Baru', address: null, mapsUrl: 'https://m/b' })).toEqual({
      workAddress: null,
      workMapsUrl: 'https://m/b',
    });
  });
});

describe('assertUnitAtLocation', () => {
  const target2 = { locationId: 'L2', name: 'Kantor Baru' };
  const targetMain = { locationId: null, name: 'Kantor Lama' };

  it('member tanpa multi lokasi: tidak ada pemeriksaan', () => {
    expect(() => assertUnitAtLocation({ locationId: 'L9' }, plain, target2)).not.toThrow();
  });

  it('unit di lokasi yang sama lolos (Lokasi 1 = null dua-duanya)', () => {
    expect(() => assertUnitAtLocation({ locationId: null }, multi, targetMain)).not.toThrow();
    expect(() => assertUnitAtLocation({ locationId: 'L2' }, multi, target2)).not.toThrow();
  });

  it('unit Lokasi 1 untuk order Kantor Baru ditolak, pesan menyebut kedua lokasi', () => {
    expect(() => assertUnitAtLocation({ locationId: null }, multi, target2)).toThrow(
      /terdaftar di lokasi "Kantor Lama", bukan lokasi pekerjaan ini \("Kantor Baru"\)/,
    );
  });

  it('unit Kantor Baru untuk order Lokasi 1 ditolak', () => {
    expect(() => assertUnitAtLocation({ locationId: 'L2', location: { name: 'Kantor Baru' } }, multi, targetMain)).toThrow(
      /terdaftar di lokasi "Kantor Baru", bukan lokasi pekerjaan ini \("Kantor Lama"\)/,
    );
  });
});
