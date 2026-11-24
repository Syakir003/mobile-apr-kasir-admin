import { BadRequestException } from '@nestjs/common';
import { ServiceOrdersService } from './service-orders.service';

// @nestjs/schedule ESM-only; terseret lewat technician-jobs -> reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Terima Servis untuk member MULTI LOKASI (AC di beberapa tempat, satu nomor HP): admin memilih lokasi pekerjaan, semua
// unit order berada di lokasi itu, unit baru ikut lokasi itu, dan alamat + link Maps lokasi itu jadi lokasi kerja job.

const multiMember = {
  id: 'm1',
  name: 'Bapak Ali',
  phone: '+62812',
  address: 'Jl. Lama 1',
  mapsUrl: null,
  multiLocation: true,
  mainLocationName: 'Kantor Lama',
};
const kantorBaru = { id: 'L2', memberId: 'm1', name: 'Kantor Baru', address: 'Jl. Baru 9', mapsUrl: 'https://m.example/baru' };

function setup(opts: { member?: Record<string, unknown>; unitAt?: { locationId: string | null; location?: { name: string } | null } } = {}) {
  const member = { ...multiMember, ...opts.member };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    member: {
      findUnique: jest.fn(async () => member),
      update: jest.fn(async ({ data }: any) => ({ ...member, ...data })),
    },
    memberLocation: { findFirst: jest.fn(async () => kantorBaru) },
    memberAcUnit: {
      findUnique: jest.fn(async () => ({
        id: 'u1',
        memberId: 'm1',
        barcodeValue: 'ACUNIT-1',
        labelPrintedAt: new Date(),
        labelAttachedAt: null,
        locationId: opts.unitAt?.locationId ?? null,
        location: opts.unitAt?.location ?? null,
      })),
    },
    technicianJob: { findMany: jest.fn(async () => []) },
    serviceOrder: { create: jest.fn(async () => ({ id: 'o1' })) },
    serviceOrderUnit: { create: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    user: { findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, role: 'teknisi', active: true }))) },
  };
  const acUnits: any = {
    registerExisting: jest.fn(async () => ({ id: 'u-baru', barcodeValue: 'ACUNIT-9', memberId: 'm1' })),
    createLegacy: jest.fn(async () => ({ id: 'u-qr', barcodeValue: 'ACUNIT-8', memberId: 'm1' })),
  };
  const technicianJobs: any = { createForOrder: jest.fn(async () => ({ id: 'j1', status: 'menunggu_penugasan' })) };
  const members: any = {
    findOrCreate: jest.fn(async () => ({ member: { ...multiMember, multiLocation: false, mainLocationName: null }, isNew: true })),
  };
  const svc = new ServiceOrdersService(prisma, members, acUnits, technicianJobs);
  return { svc, tx, acUnits, technicianJobs, members };
}

const base = {
  customer: { name: 'Bapak Ali', phone: '0812', memberId: 'm1' },
  complaint: 'Cuci AC rutin',
  jobType: 'cuci' as const,
  scheduledDate: '2026-11-25',
};

describe('ServiceOrdersService.intake — member multi lokasi', () => {
  it('lokasi pekerjaan WAJIB dipilih', async () => {
    const { svc } = setup();
    await expect(svc.intake({ ...base, units: [{ newUnit: { brand: 'Daikin' } }] } as any, 'a1')).rejects.toThrow(
      /Pilih lokasi/,
    );
  });

  it('lokasi tambahan: unit baru, order, dan lokasi kerja job semuanya mengikuti lokasi itu', async () => {
    const { svc, tx, acUnits, technicianJobs } = setup();
    await svc.intake({ ...base, locationId: 'L2', units: [{ newUnit: { brand: 'Daikin' } }, { newUnit: { qrDulu: true } }] } as any, 'a1');

    expect(acUnits.registerExisting).toHaveBeenCalledWith(tx, 'm1', expect.objectContaining({ brand: 'Daikin', locationId: 'L2' }));
    expect(acUnits.createLegacy).toHaveBeenCalledWith(tx, 'm1', expect.objectContaining({ mode: 'qr_dulu', locationId: 'L2' }));
    expect(tx.serviceOrder.create.mock.calls[0][0].data).toMatchObject({ locationId: 'L2' });
    for (const [, params] of technicianJobs.createForOrder.mock.calls) {
      expect(params).toMatchObject({ workAddress: 'Jl. Baru 9', workMapsUrl: 'https://m.example/baru' });
    }
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ locationId: 'L2', locationName: 'Kantor Baru' });
  });

  it("'utama' = Lokasi 1: locationId null dan lokasi kerja ikut alamat member (null)", async () => {
    const { svc, tx, acUnits, technicianJobs } = setup();
    await svc.intake({ ...base, locationId: 'utama', units: [{ newUnit: { brand: 'Daikin' } }] } as any, 'a1');
    expect(acUnits.registerExisting).toHaveBeenCalledWith(tx, 'm1', expect.objectContaining({ locationId: null }));
    expect(tx.serviceOrder.create.mock.calls[0][0].data.locationId).toBeNull();
    expect(technicianJobs.createForOrder.mock.calls[0][1]).toMatchObject({ workAddress: null, workMapsUrl: null });
  });

  it('unit lama di lokasi yang sama diterima', async () => {
    const { svc, technicianJobs } = setup({ unitAt: { locationId: 'L2', location: { name: 'Kantor Baru' } } });
    await svc.intake({ ...base, locationId: 'L2', units: [{ existingUnitId: 'u1' }] } as any, 'a1');
    expect(technicianJobs.createForOrder).toHaveBeenCalledTimes(1);
  });

  it('unit lama di lokasi LAIN ditolak, pesan menyebut kedua lokasi, tidak ada order dibuat', async () => {
    const { svc, tx } = setup({ unitAt: { locationId: null, location: null } });
    await expect(svc.intake({ ...base, locationId: 'L2', units: [{ existingUnitId: 'u1' }] } as any, 'a1')).rejects.toThrow(
      /terdaftar di lokasi "Kantor Lama", bukan lokasi pekerjaan ini \("Kantor Baru"\)/,
    );
    expect(tx.serviceOrder.create).not.toHaveBeenCalled();
  });

  it('titik lokasi kerja manual tidak dipakai untuk member multi lokasi', async () => {
    const { svc } = setup();
    await expect(
      svc.intake({ ...base, locationId: 'L2', units: [{ newUnit: { brand: 'A' } }], locations: [{ address: 'Jl. X' }] } as any, 'a1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('slot "teknisi yang scan" ikut lokasi pekerjaan', async () => {
    const { svc, technicianJobs } = setup();
    await svc.intake({ ...base, locationId: 'L2', scanUnitCount: 3 } as any, 'a1');
    expect(technicianJobs.createForOrder).toHaveBeenCalledTimes(3);
    for (const [, params] of technicianJobs.createForOrder.mock.calls) {
      expect(params).toMatchObject({ unitId: null, workAddress: 'Jl. Baru 9' });
    }
  });

  it('member biasa (tanpa multi lokasi) tidak boleh mengirim lokasi pekerjaan', async () => {
    const { svc } = setup({ member: { multiLocation: false } });
    await expect(svc.intake({ ...base, locationId: 'L2', units: [{ newUnit: { brand: 'A' } }] } as any, 'a1')).rejects.toThrow(
      /belum memakai multi lokasi/,
    );
  });

  it('member biasa: perilaku lama (tanpa lokasi, unit baru locationId null)', async () => {
    const { svc, tx, acUnits } = setup({ member: { multiLocation: false } });
    await svc.intake({ ...base, units: [{ newUnit: { brand: 'A' } }] } as any, 'a1');
    expect(acUnits.registerExisting).toHaveBeenCalledWith(tx, 'm1', expect.objectContaining({ locationId: null }));
    expect(tx.serviceOrder.create.mock.calls[0][0].data.locationId).toBeNull();
  });

  it('pelanggan BARU dengan saklar multi lokasi: saklar dinyalakan, otomatis Lokasi 1 tanpa memilih', async () => {
    const { svc, tx, members, technicianJobs } = setup();
    // findOrCreate mengembalikan member baru (belum multi lokasi); intake menyalakan saklarnya.
    await svc.intake(
      {
        ...base,
        customer: { name: 'Bapak Ali', phone: '0812', address: 'Jl. Lama 1', multiLocation: true, mainLocationName: ' Kantor Lama ' },
        units: [{ newUnit: { brand: 'Daikin' } }],
      } as any,
      'a1',
    );
    expect(members.findOrCreate).toHaveBeenCalled();
    expect(tx.member.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { multiLocation: true, mainLocationName: 'Kantor Lama' },
    });
    expect(tx.serviceOrder.create.mock.calls[0][0].data.locationId).toBeNull();
    expect(technicianJobs.createForOrder.mock.calls[0][1]).toMatchObject({ workAddress: null });
  });

  it('saklar multi lokasi dari form diabaikan untuk member LAMA (diatur lewat halaman member)', async () => {
    const { svc, tx } = setup({ member: { multiLocation: false } });
    await svc.intake(
      { ...base, customer: { ...base.customer, multiLocation: true }, units: [{ newUnit: { brand: 'A' } }] } as any,
      'a1',
    );
    // Hanya penambahan hitungan unit yang boleh menyentuh member; saklarnya tetap mati.
    expect(tx.member.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ multiLocation: true }) }),
    );
  });
});

// POST /service-orders (order manual dari app mobile) tidak punya field lokasi: untuk member multi lokasi, lokasi order
// diturunkan dari unit yang dipilih (semua unit harus satu lokasi).
function setupManual(memberOpts: Record<string, unknown>, units: Record<string, unknown>[]) {
  const member = { ...multiMember, active: true, ...memberOpts };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    technicianJob: { findMany: jest.fn(async () => []) },
    serviceOrder: { create: jest.fn(async () => ({ id: 'o1' })) },
    serviceOrderUnit: { create: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = {
    member: { findUnique: jest.fn(async () => member) },
    memberAcUnit: {
      findMany: jest.fn(async () => units.map((u) => ({ memberId: 'm1', locationId: null, location: null, ...u }))),
    },
    user: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const technicianJobs: any = { createForOrder: jest.fn(async () => ({ id: 'j1', technicianId: null })) };
  const svc = new ServiceOrdersService(prisma, {} as any, {} as any, technicianJobs);
  return { svc, tx, technicianJobs };
}

const manual = (unitIds: string[]) => ({ memberId: 'm1', type: 'cuci' as const, unitIds });
const atBaru = { locationId: 'L2', location: { name: 'Kantor Baru', address: 'Jl. Baru 9', mapsUrl: 'https://m.example/baru' } };

describe('ServiceOrdersService.createManual — lokasi diturunkan dari unit (member multi lokasi)', () => {
  it('semua unit di lokasi tambahan: order dan lokasi kerja job ikut lokasi itu', async () => {
    const { svc, tx, technicianJobs } = setupManual({}, [
      { id: 'u1', ...atBaru },
      { id: 'u2', ...atBaru },
    ]);
    await svc.createManual(manual(['u1', 'u2']), 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data.locationId).toBe('L2');
    expect(technicianJobs.createForOrder).toHaveBeenCalledTimes(2);
    for (const [, params] of technicianJobs.createForOrder.mock.calls) {
      expect(params).toMatchObject({ workAddress: 'Jl. Baru 9', workMapsUrl: 'https://m.example/baru' });
    }
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ locationId: 'L2', locationName: 'Kantor Baru' });
  });

  it('semua unit di Lokasi 1: order tanpa lokasi khusus, lokasi kerja ikut alamat member', async () => {
    const { svc, tx, technicianJobs } = setupManual({}, [{ id: 'u1' }, { id: 'u2' }]);
    await svc.createManual(manual(['u1', 'u2']), 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data.locationId).toBeNull();
    expect(technicianJobs.createForOrder.mock.calls[0][1]).toMatchObject({ workAddress: null, workMapsUrl: null });
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).toMatchObject({ locationId: null, locationName: 'Kantor Lama' });
  });

  it('unit di lokasi campur ditolak: pesan menyebut lokasi dan meminta order terpisah, tidak ada order dibuat', async () => {
    const { svc, tx, technicianJobs } = setupManual({}, [{ id: 'u1' }, { id: 'u2', ...atBaru }]);
    await expect(svc.createManual(manual(['u1', 'u2']), 'a1')).rejects.toThrow(
      /lokasi berbeda \(Kantor Lama, Kantor Baru\)\. Buat order terpisah untuk tiap lokasi/,
    );
    expect(tx.serviceOrder.create).not.toHaveBeenCalled();
    expect(technicianJobs.createForOrder).not.toHaveBeenCalled();
  });

  it('member biasa: perilaku lama (tanpa lokasi, campuran apa pun tidak diperiksa)', async () => {
    const { svc, tx, technicianJobs } = setupManual({ multiLocation: false }, [{ id: 'u1' }, { id: 'u2', ...atBaru }]);
    await svc.createManual(manual(['u1', 'u2']), 'a1');
    expect(tx.serviceOrder.create.mock.calls[0][0].data.locationId).toBeNull();
    expect(technicianJobs.createForOrder.mock.calls[0][1]).toMatchObject({ workAddress: null, workMapsUrl: null });
    expect(tx.auditLog.create.mock.calls[0][0].data.detail).not.toHaveProperty('locationId');
  });
});
