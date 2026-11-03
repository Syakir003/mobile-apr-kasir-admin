import { BadRequestException } from '@nestjs/common';
import { ServiceOrdersService } from './service-orders.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ServiceIntakeDto } from './dto/service-intake.dto';

// @nestjs/schedule ESM-only; terseret lewat technician-jobs -> reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

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
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const acUnits: any = {
    registerExisting: jest.fn(async () => ({ id: 'u-biasa', barcodeValue: 'ACUNIT-1', memberId: 'm1' })),
    createLegacy: jest.fn(async () => ({ id: 'u-qr', barcodeValue: 'ACUNIT-2', memberId: 'm1' })),
  };
  const technicianJobs: any = { createForOrder: jest.fn(async () => ({ id: 'j1', status: 'menunggu_penugasan' })) };
  const svc = new ServiceOrdersService(prisma, {} as any, acUnits, technicianJobs);
  return { svc, tx, acUnits, technicianJobs, prisma };
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
  const svc = new ServiceOrdersService(prisma, {} as any, acUnits, technicianJobs);
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
    expect(technicianJobs.createForOrder.mock.calls.map((c: any) => [c[1].orderId, c[1].unitId, c[1].technicianId])).toEqual([
      ['o1', 'u1', 't1'],
      ['o1', 'u2', 't1'],
      ['o1', 'u3', 't1'],
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
      (await validate(plainToInstance(ServiceIntakeDto, { customer: { name: 'A', phone: '1' }, complaint: 'x', jobType }))).filter(
        (e) => e.property === 'jobType',
      ).length;
    expect(await check('cuci')).toBe(0);
    expect(await check('maintenance')).toBe(0);
    expect(await check(undefined)).toBe(0);
    expect(await check('pemasangan')).toBe(1);
    expect(await check('asal-asalan')).toBe(1);
  });
});
