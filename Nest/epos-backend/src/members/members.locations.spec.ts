import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MembersService } from './members.service';

// Multi lokasi member: saklar ON/OFF, lokasi tambahan (Lokasi 2, 3, ...), dan memindahkan unit antar lokasi.

const baseMember = {
  id: 'm1',
  name: 'Bapak Ali',
  multiLocation: true,
  mainLocationName: 'Kantor Lama',
  address: 'Jl. Lama 1',
  mapsUrl: null,
};

function setup(
  opts: {
    member?: Record<string, unknown> | null;
    locations?: { name: string }[];
    unitsInOtherLocations?: number;
    unitsOfLocation?: number;
    ordersOfLocation?: number;
    foundLocation?: Record<string, unknown> | null;
    units?: { id: string; memberId: string }[];
    busyJobs?: unknown[];
  } = {},
) {
  const member = opts.member === null ? null : { ...baseMember, ...opts.member };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    member: { findUnique: jest.fn(async () => member), update: jest.fn(async ({ data }: any) => ({ ...member, ...data })) },
    memberLocation: {
      findMany: jest.fn(async () => opts.locations ?? []),
      findFirst: jest.fn(async () => (opts.foundLocation === undefined ? null : opts.foundLocation)),
      create: jest.fn(async ({ data }: any) => ({ id: 'L-baru', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'L2', ...data })),
      delete: jest.fn(async () => ({})),
    },
    memberAcUnit: {
      count: jest.fn(async ({ where }: any) =>
        where.locationId?.not === null ? (opts.unitsInOtherLocations ?? 0) : (opts.unitsOfLocation ?? 0),
      ),
      findMany: jest.fn(async () => opts.units ?? []),
      updateMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
    },
    serviceOrder: { count: jest.fn(async () => opts.ordersOfLocation ?? 0) },
    technicianJob: { findMany: jest.fn(async () => opts.busyJobs ?? []) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { svc: new MembersService(prisma), tx, prisma };
}

describe('MembersService.update — saklar multi lokasi', () => {
  it('dimatikan ditolak selama masih ada unit di lokasi selain Lokasi 1', async () => {
    const { svc, prisma } = setup({ unitsInOtherLocations: 3 });
    prisma.member.findUnique = jest.fn(async () => baseMember);
    await expect(svc.update('m1', { multiLocation: false }, 'a1')).rejects.toThrow(
      /masih ada 3 unit AC di lokasi selain "Kantor Lama"/,
    );
    expect(prisma.member.update).not.toHaveBeenCalled();
  });

  it('dimatikan boleh bila semua unit di Lokasi 1', async () => {
    const { svc, prisma } = setup({ unitsInOtherLocations: 0 });
    prisma.member.findUnique = jest.fn(async () => baseMember);
    await svc.update('m1', { multiLocation: false }, 'a1');
    expect(prisma.member.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { multiLocation: false } });
  });

  it('dinyalakan + nama Lokasi 1 dirapikan (kosong = kembali ke nama bawaan)', async () => {
    const { svc, prisma } = setup();
    prisma.member.findUnique = jest.fn(async () => ({ ...baseMember, multiLocation: false }));
    await svc.update('m1', { multiLocation: true, mainLocationName: '  Kantor Pusat ' }, 'a1');
    expect(prisma.member.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { multiLocation: true, mainLocationName: 'Kantor Pusat' },
    });
    await svc.update('m1', { mainLocationName: '   ' }, 'a1');
    expect(prisma.member.update).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: { mainLocationName: null } });
  });
});

describe('MembersService.addLocation', () => {
  it('member tanpa multi lokasi: ditolak', async () => {
    const { svc } = setup({ member: { multiLocation: false } });
    await expect(svc.addLocation('m1', { name: 'Kantor Baru', address: 'Jl. Baru' }, 'a1')).rejects.toThrow(
      /Aktifkan multi lokasi/,
    );
  });

  it('member tidak ada: 404', async () => {
    const { svc } = setup({ member: null });
    await expect(svc.addLocation('m1', { name: 'X', address: 'Y' }, 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('wajib alamat atau link Maps', async () => {
    const { svc } = setup();
    await expect(svc.addLocation('m1', { name: 'Kantor Baru' }, 'a1')).rejects.toThrow(/alamat atau link Maps/);
  });

  it('nama kembar (termasuk nama Lokasi 1, tanpa membedakan huruf besar/kecil) ditolak', async () => {
    const { svc } = setup({ locations: [{ name: 'Gudang' }] });
    await expect(svc.addLocation('m1', { name: 'kantor lama', address: 'x' }, 'a1')).rejects.toThrow(/sudah dipakai/);
    await expect(svc.addLocation('m1', { name: 'GUDANG', address: 'x' }, 'a1')).rejects.toThrow(/sudah dipakai/);
  });

  it('maksimal 20 lokasi tambahan', async () => {
    const { svc } = setup({ locations: Array.from({ length: 20 }, (_, i) => ({ name: `L${i}` })) });
    await expect(svc.addLocation('m1', { name: 'Baru', address: 'x' }, 'a1')).rejects.toThrow(/Maksimal 20/);
  });

  it('berhasil: tersimpan terpangkas dan tercatat di audit', async () => {
    const { svc, tx } = setup();
    const loc = await svc.addLocation('m1', { name: ' Kantor Baru ', address: ' Jl. Baru 9 ', mapsUrl: 'https://m/b' }, 'a1');
    expect(tx.memberLocation.create).toHaveBeenCalledWith({
      data: { memberId: 'm1', name: 'Kantor Baru', address: 'Jl. Baru 9', mapsUrl: 'https://m/b' },
    });
    expect(loc).toMatchObject({ name: 'Kantor Baru' });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'member.location_add', target: 'm1' });
  });
});

describe('MembersService.updateLocation', () => {
  const current = { id: 'L2', memberId: 'm1', name: 'Kantor Baru', address: 'Jl. Baru 9', mapsUrl: null };

  it('tidak boleh menghapus alamat sekaligus link (salah satu harus ada)', async () => {
    const { svc } = setup({ foundLocation: current });
    await expect(svc.updateLocation('m1', 'L2', { address: '' }, 'a1')).rejects.toThrow(/alamat atau link Maps/);
  });

  it('mengganti nama menjadi nama lokasi lain ditolak', async () => {
    const { svc, tx } = setup({ foundLocation: current });
    tx.memberLocation.findMany.mockResolvedValue([{ name: 'Gudang' }]);
    await expect(svc.updateLocation('m1', 'L2', { name: 'gudang' }, 'a1')).rejects.toThrow(/sudah dipakai/);
  });

  it('berhasil mengubah alamat saja', async () => {
    const { svc, tx } = setup({ foundLocation: current });
    await svc.updateLocation('m1', 'L2', { address: 'Jl. Pindah 5' }, 'a1');
    expect(tx.memberLocation.update).toHaveBeenCalledWith({
      where: { id: 'L2' },
      data: { name: 'Kantor Baru', address: 'Jl. Pindah 5', mapsUrl: null },
    });
  });

  it('lokasi tidak ditemukan: 404', async () => {
    const { svc } = setup({ foundLocation: null });
    await expect(svc.updateLocation('m1', 'L-x', { name: 'A' }, 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MembersService.removeLocation', () => {
  const loc = { id: 'L2', memberId: 'm1', name: 'Kantor Baru' };

  it('ditolak selama masih dipakai unit AC', async () => {
    const { svc, tx } = setup({ foundLocation: loc, unitsOfLocation: 4 });
    await expect(svc.removeLocation('m1', 'L2', 'a1')).rejects.toThrow(/masih dipakai 4 unit AC/);
    expect(tx.memberLocation.delete).not.toHaveBeenCalled();
  });

  it('ditolak bila sudah dipakai order servis (riwayat butuh lokasinya)', async () => {
    const { svc, tx } = setup({ foundLocation: loc, ordersOfLocation: 2 });
    await expect(svc.removeLocation('m1', 'L2', 'a1')).rejects.toThrow(/sudah dipakai 2 order servis/);
    expect(tx.memberLocation.delete).not.toHaveBeenCalled();
  });

  it('lokasi kosong terhapus', async () => {
    const { svc, tx } = setup({ foundLocation: loc });
    await expect(svc.removeLocation('m1', 'L2', 'a1')).resolves.toEqual({ ok: true });
    expect(tx.memberLocation.delete).toHaveBeenCalledWith({ where: { id: 'L2' } });
  });
});

describe('MembersService.moveUnitsToLocation', () => {
  it("pindah ke Lokasi 1 ('utama') = locationId null", async () => {
    const { svc, tx } = setup({ units: [{ id: 'u1', memberId: 'm1' }, { id: 'u2', memberId: 'm1' }] });
    const res = await svc.moveUnitsToLocation('m1', { unitIds: ['u1', 'u2'], locationId: 'utama' }, 'a1');
    expect(tx.memberAcUnit.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['u1', 'u2'] } }, data: { locationId: null } });
    expect(res).toMatchObject({ ok: true, moved: 2, locationId: null, locationName: 'Kantor Lama' });
  });

  it('pindah ke lokasi tambahan milik member', async () => {
    const { svc, tx } = setup({
      units: [{ id: 'u1', memberId: 'm1' }],
      foundLocation: { id: 'L2', name: 'Kantor Baru', address: 'x', mapsUrl: null },
    });
    const res = await svc.moveUnitsToLocation('m1', { unitIds: ['u1'], locationId: 'L2' }, 'a1');
    expect(tx.memberAcUnit.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['u1'] } }, data: { locationId: 'L2' } });
    expect(res).toMatchObject({ locationId: 'L2', locationName: 'Kantor Baru' });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'member.units_move_location' });
  });

  it('unit milik member lain atau tidak ditemukan: ditolak, tidak ada yang berubah', async () => {
    const { svc, tx } = setup({ units: [{ id: 'u1', memberId: 'm-lain' }] });
    await expect(svc.moveUnitsToLocation('m1', { unitIds: ['u1'], locationId: 'utama' }, 'a1')).rejects.toThrow(
      /bukan milik member ini/,
    );
    const { svc: svc2, tx: tx2 } = setup({ units: [] });
    await expect(svc2.moveUnitsToLocation('m1', { unitIds: ['u9'], locationId: 'utama' }, 'a1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.memberAcUnit.updateMany).not.toHaveBeenCalled();
    expect(tx2.memberAcUnit.updateMany).not.toHaveBeenCalled();
  });

  it('unit yang masih punya job aktif tidak dipindah', async () => {
    const { svc, tx } = setup({
      units: [{ id: 'u1', memberId: 'm1' }],
      busyJobs: [{ unit: { brand: 'Daikin', model: 'FT', roomLocation: 'Lobi', barcodeValue: 'B1' } }],
    });
    await expect(svc.moveUnitsToLocation('m1', { unitIds: ['u1'], locationId: 'utama' }, 'a1')).rejects.toThrow(
      /masih punya job servis yang belum selesai/,
    );
    expect(tx.memberAcUnit.updateMany).not.toHaveBeenCalled();
  });

  it('member tanpa multi lokasi: ditolak', async () => {
    const { svc } = setup({ member: { multiLocation: false }, units: [{ id: 'u1', memberId: 'm1' }] });
    await expect(svc.moveUnitsToLocation('m1', { unitIds: ['u1'], locationId: 'utama' }, 'a1')).rejects.toThrow(
      /Aktifkan multi lokasi/,
    );
  });
});
