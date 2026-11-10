import { BadRequestException } from '@nestjs/common';
import { ServiceOrdersService } from './service-orders.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ServiceIntakeDto } from './dto/service-intake.dto';
import { resolveWorkLocation } from './work-location.util';
import { MAPS_SEARCH_PREFIX } from '../common/maps-url.util';

// @nestjs/schedule ESM-only; terseret lewat technician-jobs -> reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Jadwal WAJIB di ServiceIntakeDto. Tes di file ini (selain yang khusus jadwal) tidak membahasnya, jadi `svc.intake`
// dibungkus agar boleh dipanggil tanpa jadwal (dilengkapi bawaan).
type IntakeInput = Omit<ServiceIntakeDto, 'scheduledDate'> & { scheduledDate?: string };
function withDefaultSchedule(real: ServiceOrdersService) {
  const realIntake = real.intake.bind(real);
  const svc = real as ServiceOrdersService & {
    intake: (dto: IntakeInput, actorId: string) => ReturnType<ServiceOrdersService['intake']>;
  };
  // Yang eksplisit di tes tetap menang atas jadwal bawaan.
  (svc as any).intake = (dto: IntakeInput, actorId: string) => realIntake({ scheduledDate: '2026-11-10', ...dto }, actorId);
  return svc;
}

// Intake servis mandiri: unit baru bisa dibuat biasa (status aktif) atau mode "QR dulu" (menunggu_data,
// jalur yang sama dengan Input Data Lampau). tx tiruan cukup untuk jalur unit baru dengan member terpilih.
function setup() {
  const tx: any = {
    member: {
      findUnique: jest.fn(async () => ({ id: 'm1', mapsUrl: null })),
      update: jest.fn(async () => ({})),
    },
    serviceOrder: { create: jest.fn(async () => ({ id: 'o1' })) },
    serviceOrderUnit: { create: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    // Semua id teknisi di tes ini valid (teknisi aktif); validasinya sendiri diuji di blok 'banyak teknisi'.
    user: {
      findMany: jest.fn(async ({ where }: any) =>
        where.id.in.map((id: string) => ({ id, role: 'teknisi', active: true })),
      ),
    },
  };
  const acUnits: any = {
    registerExisting: jest.fn(async () => ({ id: 'u-biasa', barcodeValue: 'ACUNIT-1', memberId: 'm1' })),
    createLegacy: jest.fn(async () => ({ id: 'u-qr', barcodeValue: 'ACUNIT-2', memberId: 'm1' })),
  };
  const technicianJobs: any = { createForOrder: jest.fn(async () => ({ id: 'j1', status: 'menunggu_penugasan' })) };
  const pricing: any = { setWithin: jest.fn(async () => ({ ok: true })) };
  const svc = withDefaultSchedule(new ServiceOrdersService(prisma, {} as any, acUnits, technicianJobs, pricing));
  return { svc, tx, acUnits, technicianJobs, prisma, pricing };
}

const customer = { name: 'Budi', phone: '0812', memberId: 'm1' };

describe('ServiceOrdersService.intake — unit baru mode "QR dulu"', () => {
  it('qrDulu: unit dibuat lewat createLegacy mode qr_dulu (bukan registerExisting), ruangan ikut', async () => {
    const { svc, acUnits, tx } = setup();
    const res = await svc.intake(
      { customer, complaint: 'AC bocor', newUnit: { qrDulu: true, roomLocation: 'Kamar Utama' } },
      'a1',
    );
    expect(acUnits.createLegacy).toHaveBeenCalledWith(tx, 'm1', { mode: 'qr_dulu', roomLocation: 'Kamar Utama' });
    expect(acUnits.registerExisting).not.toHaveBeenCalled();
    expect(res).toMatchObject({ unitId: 'u-qr', unitLabeled: false, jobId: 'j1' });
    // totalAcUnits tetap bertambah satu, sama seperti unit baru biasa.
    expect(tx.member.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { totalAcUnits: { increment: 1 } } });
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ qrDulu: true });
  });

  it('tanpa qrDulu: tetap registerExisting (perilaku lama tidak berubah)', async () => {
    const { svc, acUnits } = setup();
    const res = await svc.intake({ customer, complaint: 'AC bocor', newUnit: { brand: 'LG', pk: 1 } }, 'a1');
    expect(acUnits.registerExisting).toHaveBeenCalled();
    expect(acUnits.createLegacy).not.toHaveBeenCalled();
    expect(res.unitId).toBe('u-biasa');
  });

  it.each([
    ['brand', { brand: 'LG' }],
    ['model', { model: 'X' }],
    ['pk', { pk: 1 }],
    ['serialNumber', { serialNumber: 'SN1' }],
  ])('qrDulu + %s ditolak sebelum menyentuh database', async (_name, extra) => {
    const { svc, prisma } = setup();
    await expect(
      svc.intake({ customer, complaint: 'x', newUnit: { qrDulu: true, ...extra } }, 'a1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// Servis banyak AC: satu order, satu job per unit. tx tiruan ditambah unit existing milik member m1.
function multiSetup(
  existing: Record<string, { labelAttachedAt?: Date | null; memberId?: string; priorJobs?: number; activeJob?: boolean }> = {},
) {
  const { tx, acUnits, technicianJobs, prisma } = setup();
  tx.memberAcUnit = {
    findUnique: jest.fn(async ({ where }: any) => {
      const e = existing[where.id];
      if (!e) return null;
      return { id: where.id, barcodeValue: `BC-${where.id}`, memberId: e.memberId ?? 'm1', labelPrintedAt: null, labelAttachedAt: e.labelAttachedAt ?? null };
    }),
  };
  tx.$executeRaw = jest.fn(async () => 1);
  tx.technicianJob = {
    count: jest.fn(async ({ where }: any) => existing[where.unitId]?.priorJobs ?? 0),
    // job belum final pada unit (guard job ganda): unit dengan `activeJob` punya satu job aktif
    findMany: jest.fn(async ({ where }: any) =>
      (where.unitId.in as string[])
        .filter((id) => existing[id]?.activeJob)
        .map((id) => ({ unit: { brand: 'Daikin', model: null, roomLocation: `Ruang ${id}`, barcodeValue: `BC-${id}` } })),
    ),
  };
  let n = 0;
  technicianJobs.createForOrder.mockImplementation(async () => ({ id: `j${++n}`, status: 'assigned' }));
  const svc = withDefaultSchedule(new ServiceOrdersService(prisma, {} as any, acUnits, technicianJobs, {} as any));
  return { svc, tx, acUnits, technicianJobs };
}

describe('ServiceOrdersService.intake — banyak unit AC dalam satu order', () => {
  it('beberapa unit lama: satu order, satu job per unit, tidak ada yang perlu dicetak labelnya', async () => {
    const { svc, tx, technicianJobs } = multiSetup({
      u1: { labelAttachedAt: new Date() },
      u2: { priorJobs: 1 },
      u3: { labelAttachedAt: new Date() },
    });
    const res = await svc.intake(
      {
        customer,
        complaint: 'Servis rutin',
        technicianId: 't1',
        units: [{ existingUnitId: 'u1' }, { existingUnitId: 'u2' }, { existingUnitId: 'u3' }],
      },
      'a1',
    );
    expect(tx.serviceOrder.create).toHaveBeenCalledTimes(1);
    expect(tx.serviceOrderUnit.create).toHaveBeenCalledTimes(3);
    expect(technicianJobs.createForOrder).toHaveBeenCalledTimes(3);
    expect(technicianJobs.createForOrder.mock.calls.map((c: any) => [c[1].orderId, c[1].unitId, c[1].technicianIds])).toEqual([
      ['o1', 'u1', ['t1']],
      ['o1', 'u2', ['t1']],
      ['o1', 'u3', ['t1']],
    ]);
    expect(res.jobs.map((j) => j.jobId)).toEqual(['j1', 'j2', 'j3']);
    expect(res.unitsToLabel).toEqual([]); // semua sudah terlabel -> frontend langsung ke halaman job
    expect(res).toMatchObject({ jobId: 'j1', unitId: 'u1' }); // bentuk lama = entri pertama
    expect(tx.member.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { totalAcUnits: expect.anything() } }));
  });

  it('member baru: banyak unit "QR dulu" -> banyak QR menunggu data, semuanya perlu dicetak', async () => {
    const { svc, tx, acUnits } = multiSetup();
    acUnits.createLegacy
      .mockResolvedValueOnce({ id: 'q1', barcodeValue: 'ACUNIT-A', memberId: 'm1' })
      .mockResolvedValueOnce({ id: 'q2', barcodeValue: 'ACUNIT-B', memberId: 'm1' })
      .mockResolvedValueOnce({ id: 'q3', barcodeValue: 'ACUNIT-C', memberId: 'm1' });
    const res = await svc.intake(
      {
        customer,
        complaint: 'Cuci semua AC',
        units: [
          { newUnit: { qrDulu: true, roomLocation: 'Kamar 1' } },
          { newUnit: { qrDulu: true, roomLocation: 'Kamar 2' } },
          { newUnit: { qrDulu: true } },
        ],
      },
      'a1',
    );
    expect(acUnits.createLegacy).toHaveBeenCalledTimes(3);
    expect(acUnits.registerExisting).not.toHaveBeenCalled();
    // jumlah AC member naik sekaligus sebanyak unit baru, bukan satu-satu
    expect(tx.member.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { totalAcUnits: { increment: 3 } } });
    expect(res.unitsToLabel).toEqual(['q1', 'q2', 'q3']);
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ qrDulu: true, qrDuluCount: 3, unitIds: ['q1', 'q2', 'q3'] });
  });

  it('campuran unit lama terlabel + unit baru: hanya unit baru yang dicetak labelnya', async () => {
    const { svc } = multiSetup({ u1: { labelAttachedAt: new Date() } });
    const res = await svc.intake(
      { customer, complaint: 'x', units: [{ existingUnitId: 'u1' }, { newUnit: { qrDulu: true } }] },
      'a1',
    );
    expect(res.jobs.map((j) => j.unitLabeled)).toEqual([true, false]);
    expect(res.unitsToLabel).toEqual(['u-qr']);
  });

  it('unit yang sama dipilih dua kali ditolak sebelum menyentuh database', async () => {
    const { svc } = multiSetup({ u1: {} });
    await expect(
      svc.intake({ customer, complaint: 'x', units: [{ existingUnitId: 'u1' }, { existingUnitId: 'u1' }] }, 'a1'),
    ).rejects.toThrow('Unit AC yang sama dipilih lebih dari satu kali');
  });

  it('units[] bersama existingUnitId/newUnit lama ditolak', async () => {
    const { svc } = multiSetup({ u1: {} });
    await expect(
      svc.intake({ customer, complaint: 'x', existingUnitId: 'u1', units: [{ existingUnitId: 'u1' }] }, 'a1'),
    ).rejects.toThrow('Pakai units[] ATAU existingUnitId/newUnit');
  });

  it('salah satu unit milik member lain: seluruh order ditolak (tidak ada order setengah jadi)', async () => {
    const { svc } = multiSetup({ u1: {}, u2: { memberId: 'm-lain' } });
    await expect(
      svc.intake({ customer, complaint: 'x', units: [{ existingUnitId: 'u1' }, { existingUnitId: 'u2' }] }, 'a1'),
    ).rejects.toThrow('terdaftar atas nama member lain');
  });

  it('entri tanpa unit sama sekali ditolak', async () => {
    const { svc } = multiSetup();
    await expect(svc.intake({ customer, complaint: 'x', units: [{}] }, 'a1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bentuk lama (satu unit) tetap menghasilkan satu job dan field tingkat atas yang sama', async () => {
    const { svc, technicianJobs } = multiSetup({ u1: { labelAttachedAt: new Date() } });
    const res = await svc.intake({ customer, complaint: 'x', existingUnitId: 'u1' }, 'a1');
    expect(technicianJobs.createForOrder).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ serviceOrderId: 'o1', unitId: 'u1', unitLabeled: true, jobId: 'j1', jobStatus: 'assigned' });
    expect(res.jobs).toHaveLength(1);
  });
});

describe('ServiceOrdersService.intake — keluhan wajib, deskripsi pekerjaan opsional', () => {
  it('servis rutin: keluhan diisi pekerjaannya ("Cuci AC") -> jadi temuan awal', async () => {
    const { svc, tx, technicianJobs } = multiSetup({ u1: { labelAttachedAt: new Date() } });
    await svc.intake({ customer, complaint: ' Cuci AC ', existingUnitId: 'u1' }, 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data.note).toBe('Cuci AC');
    expect(technicianJobs.createForOrder.mock.calls[0][1].complaint).toBe('Cuci AC');
  });

  it('deskripsi + keluhan: note = deskripsi, keluhan jadi temuan awal', async () => {
    const { svc, tx, technicianJobs } = multiSetup({ u1: { labelAttachedAt: new Date() } });
    await svc.intake({ customer, workDescription: 'Servis AC', complaint: 'Bocor', existingUnitId: 'u1' }, 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data.note).toBe('Servis AC');
    expect(technicianJobs.createForOrder.mock.calls[0][1].complaint).toBe('Bocor');
  });

  it('keluhan saja (klien lama / mobile): note = keluhan seperti sebelumnya', async () => {
    const { svc, tx } = multiSetup({ u1: { labelAttachedAt: new Date() } });
    await svc.intake({ customer, complaint: 'AC bocor', existingUnitId: 'u1' }, 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data.note).toBe('AC bocor');
  });

  it('keluhan kosong ditolak, walau deskripsi pekerjaan diisi', async () => {
    const { svc, tx } = multiSetup({ u1: {} });
    await expect(svc.intake({ customer, complaint: '  ', existingUnitId: 'u1' }, 'a1')).rejects.toThrow('Keluhan awal wajib diisi');
    await expect(
      svc.intake({ customer, workDescription: 'Cuci AC rutin', existingUnitId: 'u1' }, 'a1'),
    ).rejects.toThrow('Keluhan awal wajib diisi');
    expect(tx.serviceOrder.create).not.toHaveBeenCalled();
  });
});

describe('ServiceOrdersService.intake — mencegah job ganda pada unit', () => {
  it('unit yang masih punya job aktif ditolak, tidak ada order/job yang dibuat', async () => {
    const { svc, tx, technicianJobs } = multiSetup({ u1: {}, u2: { activeJob: true } });
    await expect(
      svc.intake({ customer, complaint: 'Cuci', units: [{ existingUnitId: 'u1' }, { existingUnitId: 'u2' }] }, 'a1'),
    ).rejects.toThrow(/masih punya job servis yang belum selesai: Daikin \(Ruang u2\)/);
    expect(tx.serviceOrder.create).not.toHaveBeenCalled();
    expect(technicianJobs.createForOrder).not.toHaveBeenCalled();
    // yang dicek hanya status belum-final (selesai/dibatalkan boleh dibuatkan job baru)
    expect(tx.technicianJob.findMany.mock.calls[0][0].where).toEqual({
      unitId: { in: ['u1', 'u2'] },
      status: { notIn: ['selesai', 'dibatalkan'] },
    });
    // baris unit dikunci dulu supaya dua order bersamaan tidak sama-sama lolos
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('unit tanpa job aktif (riwayat lama sudah selesai) tetap bisa dibuatkan job', async () => {
    const { svc, technicianJobs } = multiSetup({ u1: { priorJobs: 2 } });
    await svc.intake({ customer, complaint: 'Cuci', existingUnitId: 'u1' }, 'a1');
    expect(technicianJobs.createForOrder).toHaveBeenCalledTimes(1);
  });
});

describe('ServiceOrdersService.intake — jenis pekerjaan', () => {
  it('jobType dipakai untuk jenis order DAN semua job-nya (cuci rutin meminta siklus servis saat disetujui)', async () => {
    const { svc, tx, technicianJobs } = multiSetup({ u1: { labelAttachedAt: new Date() }, u2: { labelAttachedAt: new Date() } });
    await svc.intake(
      { customer, complaint: 'Cuci AC', jobType: 'cuci', units: [{ existingUnitId: 'u1' }, { existingUnitId: 'u2' }] },
      'a1',
    );
    expect(tx.serviceOrder.create.mock.calls[0][0].data.type).toBe('cuci');
    expect(technicianJobs.createForOrder.mock.calls.map((c: any) => c[1].type)).toEqual(['cuci', 'cuci']);
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ jobType: 'cuci' });
  });

  it('tanpa jobType: tetap perbaikan (klien lama tidak berubah)', async () => {
    const { svc, tx, technicianJobs } = multiSetup({ u1: { labelAttachedAt: new Date() } });
    await svc.intake({ customer, complaint: 'AC bocor', existingUnitId: 'u1' }, 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data.type).toBe('perbaikan');
    expect(technicianJobs.createForOrder.mock.calls[0][1].type).toBe('perbaikan');
  });

  it('validasi DTO: hanya perbaikan/cuci/maintenance; pemasangan dan nilai asing ditolak, kosong boleh', async () => {
    const check = async (jobType?: unknown) =>
      (await validate(plainToInstance(ServiceIntakeDto, { customer: { name: 'A', phone: '1' }, complaint: 'x', scheduledDate: '2026-11-10', jobType }))).filter(
        (e) => e.property === 'jobType',
      ).length;
    expect(await check('cuci')).toBe(0);
    expect(await check('maintenance')).toBe(0);
    expect(await check(undefined)).toBe(0);
    expect(await check('pemasangan')).toBe(1);
    expect(await check('asal-asalan')).toBe(1);
  });
});

// Titik lokasi kerja: satu pelanggan bisa punya AC di beberapa tempat. Tiap unit memilih titiknya; titik tanpa isi atau
// tanpa pilihan (saat titiknya banyak) berarti ikut alamat pelanggan.
describe('resolveWorkLocation', () => {
  const pts = [
    { address: ' Jl. Melati 5 ', mapsUrl: 'https://maps.app.goo.gl/abc' },
    { address: 'Mojokerto kota' },
    {},
  ];

  it('memilih titik menurut indeks (alamat dirapikan), link opsional', () => {
    expect(resolveWorkLocation(pts, 0)).toEqual({ workAddress: 'Jl. Melati 5', workMapsUrl: 'https://maps.app.goo.gl/abc' });
    expect(resolveWorkLocation(pts, 1)).toEqual({ workAddress: 'Mojokerto kota', workMapsUrl: null });
  });

  it('titik tanpa isi = ikut alamat pelanggan (null/null)', () => {
    expect(resolveWorkLocation(pts, 2)).toEqual({ workAddress: null, workMapsUrl: null });
  });

  it('tanpa pilihan: titik tunggal dipakai semua unit; banyak titik atau tanpa titik = ikut alamat pelanggan', () => {
    expect(resolveWorkLocation([pts[1]], undefined)).toEqual({ workAddress: 'Mojokerto kota', workMapsUrl: null });
    expect(resolveWorkLocation(pts, undefined)).toEqual({ workAddress: null, workMapsUrl: null });
    expect(resolveWorkLocation(undefined, undefined)).toEqual({ workAddress: null, workMapsUrl: null });
  });

  it('indeks di luar daftar ditolak (400)', () => {
    expect(() => resolveWorkLocation(pts, 3)).toThrow(BadRequestException);
    expect(() => resolveWorkLocation(undefined, 0)).toThrow(BadRequestException);
  });
});

describe('ServiceOrdersService.intake — titik lokasi kerja per unit', () => {
  const locs = [
    { address: 'Rumah: Jl. Melati 5', mapsUrl: 'https://maps.app.goo.gl/rumah' },
    { address: 'Ruko Mojokerto' },
  ];

  it('tiap unit mendapat titik pilihannya di job-nya (alamat + link), unit tanpa pilihan ikut alamat pelanggan', async () => {
    const { svc, technicianJobs } = multiSetup({ u1: { labelAttachedAt: new Date() }, u2: { labelAttachedAt: new Date() }, u3: { labelAttachedAt: new Date() } });
    await svc.intake(
      {
        customer,
        complaint: 'Servis rutin',
        locations: locs,
        units: [
          { existingUnitId: 'u1', locationIndex: 0 },
          { existingUnitId: 'u2', locationIndex: 1 },
          { existingUnitId: 'u3' },
        ],
      },
      'a1',
    );
    const calls = technicianJobs.createForOrder.mock.calls.map((c: any[]) => c[1]);
    expect(calls[0]).toMatchObject({ unitId: 'u1', workAddress: 'Rumah: Jl. Melati 5', workMapsUrl: 'https://maps.app.goo.gl/rumah' });
    expect(calls[1]).toMatchObject({ unitId: 'u2', workAddress: 'Ruko Mojokerto', workMapsUrl: null });
    expect(calls[2]).toMatchObject({ unitId: 'u3', workAddress: null, workMapsUrl: null });
  });

  it('satu titik saja: dipakai semua unit tanpa perlu memilih', async () => {
    const { svc, technicianJobs } = multiSetup({ u1: { labelAttachedAt: new Date() }, u2: { labelAttachedAt: new Date() } });
    await svc.intake(
      { customer, complaint: 'Servis', locations: [{ address: 'Ruko Mojokerto' }], units: [{ existingUnitId: 'u1' }, { existingUnitId: 'u2' }] },
      'a1',
    );
    for (const c of technicianJobs.createForOrder.mock.calls) {
      expect(c[1]).toMatchObject({ workAddress: 'Ruko Mojokerto', workMapsUrl: null });
    }
  });

  it('tanpa titik lokasi: job ikut alamat pelanggan (perilaku lama tidak berubah)', async () => {
    const { svc, technicianJobs } = multiSetup({ u1: { labelAttachedAt: new Date() } });
    await svc.intake({ customer, complaint: 'Servis', units: [{ existingUnitId: 'u1' }] }, 'a1');
    expect(technicianJobs.createForOrder.mock.calls[0][1]).toMatchObject({ workAddress: null, workMapsUrl: null });
  });

  it('unit baru juga bisa memilih titik', async () => {
    const { svc, technicianJobs } = multiSetup();
    await svc.intake(
      { customer, complaint: 'Servis', locations: locs, units: [{ newUnit: { qrDulu: true }, locationIndex: 1 }] },
      'a1',
    );
    expect(technicianJobs.createForOrder.mock.calls[0][1]).toMatchObject({ workAddress: 'Ruko Mojokerto' });
  });

  it('pilihan titik yang tidak ada ditolak sebelum menyentuh database', async () => {
    const { svc, tx } = multiSetup({ u1: {} });
    tx.serviceOrder.create.mockClear();
    await expect(
      svc.intake({ customer, complaint: 'Servis', locations: locs, units: [{ existingUnitId: 'u1', locationIndex: 5 }] }, 'a1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.serviceOrder.create).not.toHaveBeenCalled();
  });
});

describe('ServiceIntakeDto — validasi titik lokasi kerja', () => {
  const base = {
    customer: { name: 'Budi', phone: '081234567890' },
    complaint: 'x',
    scheduledDate: '2026-11-10',
    units: [{ existingUnitId: 'u1' }],
  };
  const errorsOf = async (extra: Record<string, unknown>) =>
    (await validate(plainToInstance(ServiceIntakeDto, { ...base, ...extra }), { whitelist: true })).length;

  it('alamat teks bebas (nama daerah saja boleh) dan link Maps boleh link penuh', async () => {
    expect(await errorsOf({ locations: [{ address: 'Mojokerto kota' }] })).toBe(0);
    expect(await errorsOf({ locations: [{ address: 'Ruko', mapsUrl: 'https://maps.app.goo.gl/abc' }] })).toBe(0);
  });

  it('link Maps yang diketik biasa (tanpa https) dinormalkan jadi link, baik untuk titik lokasi maupun alamat utama pelanggan', async () => {
    const dto = plainToInstance(ServiceIntakeDto, {
      ...base,
      customer: { ...base.customer, mapsUrl: 'Perumahan Griya Asri' },
      locations: [{ address: 'Ruko', mapsUrl: 'goo.gl/maps/xyz' }, { address: 'Rumah', mapsUrl: 'Mojokerto kota' }, { address: 'Kosong', mapsUrl: '   ' }],
    });
    expect(await validate(dto, { whitelist: true })).toHaveLength(0);
    expect(dto.customer.mapsUrl).toBe(MAPS_SEARCH_PREFIX + 'Perumahan%20Griya%20Asri');
    expect(dto.locations?.[0].mapsUrl).toBe('https://goo.gl/maps/xyz');
    expect(dto.locations?.[1].mapsUrl).toBe(MAPS_SEARCH_PREFIX + 'Mojokerto%20kota');
    expect(dto.locations?.[2].mapsUrl).toBeNull();
  });

  it('batas jumlah titik dan indeks pilihan unit', async () => {
    expect(await errorsOf({ locations: Array.from({ length: 21 }, () => ({ address: 'x' })) })).toBeGreaterThan(0);
    expect(await errorsOf({ units: [{ existingUnitId: 'u1', locationIndex: -1 }] })).toBeGreaterThan(0);
    expect(await errorsOf({ units: [{ existingUnitId: 'u1', locationIndex: 1.5 }] })).toBeGreaterThan(0);
  });
});

// Jadwal servis WAJIB (2026-11): menentukan filter hari di Antrian Servis dan dashboard teknisi.
describe('ServiceIntakeDto — jadwal wajib', () => {
  const base = { customer: { name: 'Budi', phone: '081234567890' }, complaint: 'x', units: [{ existingUnitId: 'u1' }] };
  const jadwalErrors = async (extra: Record<string, unknown>) =>
    (await validate(plainToInstance(ServiceIntakeDto, { ...base, ...extra }))).filter((e) => e.property === 'scheduledDate');

  it('tanpa jadwal ditolak dengan pesan jelas', async () => {
    const e = await jadwalErrors({});
    expect(e).toHaveLength(1);
    expect(JSON.stringify(e[0].constraints)).toContain('Jadwal wajib diisi');
    expect(await jadwalErrors({ scheduledDate: undefined })).toHaveLength(1);
    expect(await jadwalErrors({ scheduledDate: '' })).toHaveLength(1);
  });

  it('format bukan tanggal ditolak', async () => {
    expect(await jadwalErrors({ scheduledDate: 'besok' })).toHaveLength(1);
    expect(await jadwalErrors({ scheduledDate: '10/11/2026' })).toHaveLength(1);
  });

  it('tanggal YYYY-MM-DD yang benar diterima', async () => {
    expect(await jadwalErrors({ scheduledDate: '2026-11-10' })).toHaveLength(0);
  });
});

describe('ServiceOrdersService.intake — banyak teknisi', () => {
  const validUsers = () => ({
    findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, role: 'teknisi', active: true }))),
  });

  it('technicianIds diteruskan ke createForOrder; respons mencatat teknisinya', async () => {
    const { svc, tx, technicianJobs, prisma } = setup();
    prisma.user = validUsers();
    await svc.intake({ customer, complaint: 'AC bocor', newUnit: { qrDulu: true }, technicianIds: ['a', 'b'] } as any, 'a1');
    expect(technicianJobs.createForOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ technicianIds: ['a', 'b'] }));
  });

  it('jalur lama technicianId tunggal tetap jalan (dianggap daftar berisi satu)', async () => {
    const { svc, tx, technicianJobs, prisma } = setup();
    prisma.user = validUsers();
    await svc.intake({ customer, complaint: 'AC bocor', newUnit: { qrDulu: true }, technicianId: 'a' } as any, 'a1');
    expect(technicianJobs.createForOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ technicianIds: ['a'] }));
  });

  it('lebih dari 5 teknisi / bukan teknisi aktif ditolak 400 sebelum transaksi dibuka', async () => {
    const { svc, prisma } = setup();
    prisma.user = validUsers();
    await expect(
      svc.intake(
        { customer, complaint: 'AC bocor', newUnit: { qrDulu: true }, technicianIds: ['a', 'b', 'c', 'd', 'e', 'f'] } as any,
        'a1',
      ),
    ).rejects.toThrow(BadRequestException);
    prisma.user = { findMany: jest.fn(async () => [{ id: 'k', role: 'kasir', active: true }]) };
    await expect(
      svc.intake({ customer, complaint: 'AC bocor', newUnit: { qrDulu: true }, technicianIds: ['k'] } as any, 'a1'),
    ).rejects.toThrow(/Teknisi tidak valid/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('ServiceOrdersService.createManual — banyak teknisi', () => {
  it('teknisi tidak valid ditolak sebelum order dibuat; yang valid diteruskan ke createForOrder + assignedJobs', async () => {
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      technicianJob: { findMany: jest.fn(async () => []) },
      serviceOrder: { create: jest.fn(async () => ({ id: 'o1' })) },
      serviceOrderUnit: { create: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      member: { findUnique: jest.fn(async () => ({ id: 'm1', active: true })) },
      memberAcUnit: { findMany: jest.fn(async () => [{ id: 'u1', memberId: 'm1' }]) },
      user: { findMany: jest.fn(async () => [{ id: 'a', role: 'teknisi', active: true }, { id: 'b', role: 'teknisi', active: true }]) },
      technicianJob: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const technicianJobs: any = { createForOrder: jest.fn(async () => ({ id: 'j1', technicianId: 'a' })) };
    const svc = new ServiceOrdersService(prisma, {} as any, {} as any, technicianJobs, {} as any);

    const res: any = await svc.createManual({ memberId: 'm1', type: 'service', unitIds: ['u1'], technicianIds: ['a', 'b'] } as any, 'adm');
    expect(technicianJobs.createForOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ technicianIds: ['a', 'b'] }));
    expect(res.assignedJobs).toEqual([{ jobId: 'j1', technicianId: 'a', technicianIds: ['a', 'b'] }]);

    prisma.user.findMany = jest.fn(async () => [{ id: 'a', role: 'teknisi', active: true }]);
    prisma.$transaction.mockClear();
    await expect(
      svc.createManual({ memberId: 'm1', type: 'service', unitIds: ['u1'], technicianIds: ['a', 'x'] } as any, 'adm'),
    ).rejects.toThrow(/Teknisi tidak valid/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('ServiceOrdersService.intake — cara tagih', () => {
  const unit = { brand: 'LG', pk: 1 };

  it('bawaan API: ditagih_admin (app Flutter lama tidak mengirim field ini dan tidak boleh kena gerbang pembayaran lapangan)', async () => {
    const { svc, tx } = setup();
    await svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit }, 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data).toMatchObject({ paymentMode: 'ditagih_admin' });
  });

  it('bayar_di_lokasi tersimpan bila dipilih (form web)', async () => {
    const { svc, tx } = setup();
    await svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit, paymentMode: 'bayar_di_lokasi' }, 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data).toMatchObject({ paymentMode: 'bayar_di_lokasi' });
  });

  it('DTO menolak cara tagih yang tidak dikenal', async () => {
    const dto = plainToInstance(ServiceIntakeDto, {
      customer: { name: 'Budi', phone: '0812', memberId: 'm1' },
      complaint: 'x',
      scheduledDate: '2026-11-10',
      paymentMode: 'kredit',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'paymentMode')).toBe(true);
  });
});

describe('ServiceOrdersService.intake — harga perkiraan di depan', () => {
  const unit = { brand: 'LG', pk: 1 };
  const lines = [{ serviceId: 's1', qty: 2, unitPrice: 75000 }];

  it('serviceLines: harga ditetapkan di transaksi yang sama untuk job pertama', async () => {
    const { svc, tx, pricing } = setup();
    await svc.intake(
      { customer, complaint: 'Cuci AC', newUnit: unit, serviceLines: lines, transportLevel: 1, transportMode: 'individu' },
      'a1',
    );
    expect(pricing.setWithin).toHaveBeenCalledWith(tx, 'j1', { lines, transportLevel: 1, transportMode: 'individu' }, 'a1');
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ priced: true });
  });

  it('tanpa serviceLines: harga tidak disentuh (perilaku lama)', async () => {
    const { svc, pricing } = setup();
    await svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit }, 'a1');
    expect(pricing.setWithin).not.toHaveBeenCalled();
  });

  it('transport tanpa baris jasa ditolak 400 sebelum transaksi dibuka', async () => {
    const { svc, prisma } = setup();
    await expect(svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit, transportLevel: 1 }, 'a1')).rejects.toThrow(
      'Transport hanya bisa diisi bersama baris jasa',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('transportLevel 0 / null / hanya transportMode tanpa baris jasa: tidak ditolak dan diabaikan', async () => {
    for (const extra of [{ transportLevel: 0 }, { transportLevel: null }, { transportMode: 'dibagi' }, { transportLevel: 0, transportMode: 'individu' }]) {
      const { svc, pricing } = setup();
      await expect(svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit, ...extra } as any, 'a1')).resolves.toBeDefined();
      expect(pricing.setWithin).not.toHaveBeenCalled();
    }
  });

  it('transportLevel/transportMode null tidak pernah diteruskan ke setWithin (Prisma menolak null): jadi undefined', async () => {
    const { svc, tx, pricing } = setup();
    await svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit, serviceLines: lines, transportLevel: null, transportMode: null } as any, 'a1');
    expect(pricing.setWithin).toHaveBeenCalledTimes(1);
    const dto = pricing.setWithin.mock.calls[0][2];
    expect(dto).toEqual({ lines, transportLevel: undefined, transportMode: undefined });
    expect(dto.transportLevel).toBeUndefined();
    expect(dto.transportMode).toBeUndefined();
    expect(pricing.setWithin.mock.calls[0][0]).toBe(tx);
  });

  it('transaksi diberi timeout 20 detik bila ada harga (banyak query dalam satu transaksi)', async () => {
    const { svc, prisma } = setup();
    await svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit, serviceLines: lines }, 'a1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ timeout: 20000 });
  });

  it('transaksi tanpa harga memakai bawaan Prisma (argumen kedua undefined)', async () => {
    const { svc, prisma } = setup();
    await svc.intake({ customer, complaint: 'Cuci AC', newUnit: unit }, 'a1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toBeUndefined();
  });
});
