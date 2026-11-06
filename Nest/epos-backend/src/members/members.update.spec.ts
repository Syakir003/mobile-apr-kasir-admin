import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MembersService } from './members.service';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MAPS_SEARCH_PREFIX } from '../common/maps-url.util';

// Edit data member (PATCH /members/:id): link Google Maps ikut bisa diubah dan dikosongkan; nomor HP tetap dinormalisasi.

const dtoOf = (plain: Record<string, unknown>) => plainToInstance(UpdateMemberDto, plain);
const errorsOf = async (plain: Record<string, unknown>) => (await validate(dtoOf(plain), { whitelist: true })).length;

describe('UpdateMemberDto — link Maps', () => {
  it('link http/https diterima dan dirapikan; field lain tidak wajib', async () => {
    const dto = dtoOf({ mapsUrl: '  https://maps.app.goo.gl/abc  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.mapsUrl).toBe('https://maps.app.goo.gl/abc');
  });

  it('kosong atau spasi saja = hapus link (null), bukan galat', async () => {
    const a = dtoOf({ mapsUrl: '' });
    const b = dtoOf({ mapsUrl: '   ' });
    expect(a.mapsUrl).toBeNull();
    expect(b.mapsUrl).toBeNull();
    expect(await validate(a)).toHaveLength(0);
    expect(await validate(b)).toHaveLength(0);
  });

  it('ketikan biasa (nama daerah) dan domain tanpa https diterima: dinormalkan jadi link yang bisa dibuka', async () => {
    const teks = dtoOf({ mapsUrl: 'Mojokerto kota' });
    expect(teks.mapsUrl).toBe(MAPS_SEARCH_PREFIX + 'Mojokerto%20kota');
    expect(await validate(teks)).toHaveLength(0);
    const domain = dtoOf({ mapsUrl: 'maps.app.goo.gl/abc' });
    expect(domain.mapsUrl).toBe('https://maps.app.goo.gl/abc');
    expect(await validate(domain)).toHaveLength(0);
  });

  it('link yang kelewat panjang tetap ditolak', async () => {
    expect(await errorsOf({ mapsUrl: 'https://x.y/' + 'a'.repeat(500) })).toBeGreaterThan(0);
  });

  it('tidak dikirim = tidak diubah (undefined)', () => {
    expect(dtoOf({ name: 'Budi' }).mapsUrl).toBeUndefined();
  });
});

describe('MembersService.update — data member', () => {
  function setup(existing: unknown = { id: 'm1' }) {
    const prisma: any = {
      member: {
        findUnique: jest.fn(async () => existing),
        update: jest.fn(async ({ data }: any) => ({ id: 'm1', ...data })),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    return { svc: new MembersService(prisma), prisma };
  }

  it('menyimpan alamat dan link Maps, nomor HP dinormalisasi, dan tercatat di audit', async () => {
    const { svc, prisma } = setup();
    await svc.update('m1', { name: 'Budi', phone: '0812-3456-7001', address: 'Jl. Melati 5', mapsUrl: 'https://maps.app.goo.gl/abc' }, 'a1');
    expect(prisma.member.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { name: 'Budi', address: 'Jl. Melati 5', mapsUrl: 'https://maps.app.goo.gl/abc', phone: '+6281234567001' },
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'member.update', target: 'm1' });
  });

  it('link Maps null menghapus link di database; field yang tidak dikirim tidak disentuh', async () => {
    const { svc, prisma } = setup();
    await svc.update('m1', { mapsUrl: null }, 'a1');
    expect(prisma.member.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { mapsUrl: null } });
  });

  it('member tidak ada: 404', async () => {
    const { svc } = setup(null);
    await expect(svc.update('x', { name: 'Budi' }, 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
