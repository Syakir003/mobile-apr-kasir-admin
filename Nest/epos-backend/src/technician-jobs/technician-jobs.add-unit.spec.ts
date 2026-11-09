import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';

// Guard akses job kini berbasis tabel assignees (semua teknisi job setara); di tes ini pemilik job = 't1'.
const ownerAssignee = {
  count: jest.fn(async ({ where }: any) => (where.technicianId === 't1' ? 1 : 0)),
};


// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Teknisi menambah unit AC ke job yang sedang dikerjakan: unit berlabel (scan barcode) atau AC tanpa label (QR baru).
// Dijaga: unit tambahan jadi job baru di ORDER YANG SAMA, hanya untuk pelanggan yang sama, tanpa job ganda, hanya
// saat job Sedang Dikerjakan, dan bukan untuk order pemasangan.

function setup(
  opts: {
    job?: Record<string, unknown>;
    unit?: Record<string, unknown> | null;
    sameOrderCount?: number;
    busyUnits?: unknown[];
    orderUnit?: { id: string } | null;
    invoiceId?: string | null;
  } = {},
) {
  const job = {
    id: 'j1',
    orderId: 'o1',
    memberId: 'm1',
    technicianId: 't1',
    status: 'sedang_dikerjakan',
    type: 'perbaikan',
    scheduledDate: null,
    member: { id: 'm1', name: 'Bu Sari' },
    technician: { displayName: 'Andi' },
    assignees: [{ technicianId: 't1' }],
    ...opts.job,
  };
  const labeledUnit = {
    id: 'u2',
    memberId: 'm1',
    barcodeValue: 'ACUNIT-20261001-0002',
    status: 'aktif',
    ...opts.unit,
  };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    technicianJobAssignee: ownerAssignee,
    technicianJob: {
      findUnique: jest.fn(async () => job),
      count: jest.fn(async () => opts.sameOrderCount ?? 0),
      findMany: jest.fn(async () => opts.busyUnits ?? []),
    },
    memberAcUnit: {
      findUnique: jest.fn(async () =>
        opts.unit === null ? null : labeledUnit,
      ),
    },
    member: { update: jest.fn(async () => ({})) },
    serviceOrderUnit: {
      findFirst: jest.fn(async () => opts.orderUnit ?? null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
    serviceOrder: {
      findUnique: jest.fn(async () => ({
        invoiceId: opts.invoiceId === undefined ? null : opts.invoiceId,
      })),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const acUnits: any = {
    createLegacy: jest.fn(async () => ({
      id: 'u9',
      barcodeValue: 'ACUNIT-20261104-0009',
      status: 'menunggu_data',
    })),
  };
  const svc = new TechnicianJobsService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    acUnits,
  );
  const createForOrder = jest
    .spyOn(svc, 'createForOrder')
    .mockResolvedValue({ id: 'j2' } as any);
  return { svc, tx, prisma, acUnits, createForOrder };
}

describe('TechnicianJobsService.addUnit — mewarisi semua teknisi job asal', () => {
  it('unit tambahan dipegang SEMUA assignee job asal, bukan hanya teknisi pertama', async () => {
    const { svc, tx, createForOrder } = setup({ job: { assignees: [{ technicianId: 't1' }, { technicianId: 't2' }] } });
    await svc.addUnit('j1', { barcode: 'ACUNIT-20261001-0002', complaint: 'Cuci AC' }, 't1', 'teknisi');
    expect(createForOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ technicianIds: ['t1', 't2'] }));
  });
});

describe('TechnicianJobsService.addUnit — unit sudah berlabel (scan barcode)', () => {
  it('membuat job baru di order yang sama untuk unit itu, dengan temuan awal dari keluhan', async () => {
    const { svc, tx, createForOrder, acUnits } = setup();
    const r = await svc.addUnit(
      'j1',
      { barcode: ' ACUNIT-20261001-0002 ', complaint: '  Cuci AC kamar  ' },
      't1',
      'teknisi',
    );
    expect(tx.memberAcUnit.findUnique).toHaveBeenCalledWith({
      where: { barcodeValue: 'ACUNIT-20261001-0002' },
    });
    expect(tx.serviceOrderUnit.create).toHaveBeenCalledWith({
      data: { orderId: 'o1', unitId: 'u2', status: 'terjadwal' },
    });
    expect(createForOrder).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orderId: 'o1',
        memberId: 'm1',
        unitId: 'u2',
        technicianIds: ['t1'],
        type: 'perbaikan',
        actorId: 't1',
        complaint: 'Cuci AC kamar',
      }),
    );
    expect(acUnits.createLegacy).not.toHaveBeenCalled();
    expect(tx.member.update).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      ok: true,
      jobId: 'j2',
      unitId: 'u2',
      needsLabel: false,
      needsData: false,
      needsPricing: false,
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'job.add_unit', target: 'j2' }),
      }),
    );
  });

  it('jenis pekerjaan bisa dipilih; tanpa pilihan mengikuti jenis job, jenis lama yang tak dikenal jadi perbaikan', async () => {
    const a = setup();
    await a.svc.addUnit(
      'j1',
      { barcode: 'B', complaint: 'Cuci', jobType: 'cuci' },
      't1',
      'teknisi',
    );
    expect(a.createForOrder).toHaveBeenCalledWith(
      a.tx,
      expect.objectContaining({ type: 'cuci' }),
    );

    const b = setup({ job: { type: 'maintenance' } });
    await b.svc.addUnit(
      'j1',
      { barcode: 'B', complaint: 'Cek rutin' },
      't1',
      'teknisi',
    );
    expect(b.createForOrder).toHaveBeenCalledWith(
      b.tx,
      expect.objectContaining({ type: 'maintenance' }),
    );

    const c = setup({ job: { type: 'service' } });
    await c.svc.addUnit(
      'j1',
      { barcode: 'B', complaint: 'AC bocor' },
      't1',
      'teknisi',
    );
    expect(c.createForOrder).toHaveBeenCalledWith(
      c.tx,
      expect.objectContaining({ type: 'perbaikan' }),
    );
  });

  it('invoice order sudah ada (harga pernah ditetapkan): needsPricing true supaya admin memperbarui harga', async () => {
    const { svc } = setup({ invoiceId: 'inv1' });
    const r = await svc.addUnit(
      'j1',
      { barcode: 'B', complaint: 'Cuci' },
      't1',
      'teknisi',
    );
    expect(r.needsPricing).toBe(true);
  });

  it('unit pernah ada di order ini (jobnya dibatalkan): barisnya dipakai ulang, tidak dobel', async () => {
    const { svc, tx } = setup({ orderUnit: { id: 'ou1' } });
    await svc.addUnit(
      'j1',
      { barcode: 'B', complaint: 'Cuci' },
      't1',
      'teknisi',
    );
    expect(tx.serviceOrderUnit.update).toHaveBeenCalledWith({
      where: { id: 'ou1' },
      data: { status: 'terjadwal' },
    });
    expect(tx.serviceOrderUnit.create).not.toHaveBeenCalled();
  });

  it('unit milik pelanggan lain ditolak', async () => {
    const { svc, createForOrder } = setup({ unit: { memberId: 'm-lain' } });
    await expect(
      svc.addUnit('j1', { barcode: 'B', complaint: 'Cuci' }, 't1', 'teknisi'),
    ).rejects.toThrow(/pelanggan lain/);
    expect(createForOrder).not.toHaveBeenCalled();
  });

  it('barcode tidak dikenal: 404', async () => {
    const { svc } = setup({ unit: null });
    await expect(
      svc.addUnit('j1', { barcode: 'X', complaint: 'Cuci' }, 't1', 'teknisi'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unit sudah ada di job ini: ditolak (bukan job ganda di order yang sama)', async () => {
    const { svc, createForOrder } = setup({ sameOrderCount: 1 });
    await expect(
      svc.addUnit('j1', { barcode: 'B', complaint: 'Cuci' }, 't1', 'teknisi'),
    ).rejects.toThrow(/sudah ada di job ini/);
    expect(createForOrder).not.toHaveBeenCalled();
  });

  it('unit masih punya job aktif di order lain: ditolak (penjagaan job ganda yang sama dengan Terima Servis)', async () => {
    const { svc, createForOrder } = setup({
      busyUnits: [
        {
          unit: {
            brand: 'Daikin',
            model: 'FTV25',
            roomLocation: 'Ruang Tamu',
            barcodeValue: 'ACUNIT-1',
          },
        },
      ],
    });
    await expect(
      svc.addUnit('j1', { barcode: 'B', complaint: 'Cuci' }, 't1', 'teknisi'),
    ).rejects.toThrow(/masih punya job servis yang belum selesai/);
    expect(createForOrder).not.toHaveBeenCalled();
  });
});

describe('TechnicianJobsService.addUnit — lokasi kerja', () => {
  it('unit tambahan mewarisi titik lokasi kerja job asal (umumnya di tempat yang sama)', async () => {
    const { svc, tx, createForOrder } = setup({
      job: { workAddress: 'Ruko Mojokerto', workMapsUrl: 'https://maps.app.goo.gl/ruko' },
    });
    await svc.addUnit('j1', { barcode: 'B', complaint: 'Cuci' }, 't1', 'teknisi');
    expect(createForOrder).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ workAddress: 'Ruko Mojokerto', workMapsUrl: 'https://maps.app.goo.gl/ruko' }),
    );
  });

  it('job asal tanpa titik lokasi (ikut alamat pelanggan): unit tambahan juga ikut alamat pelanggan', async () => {
    const { svc, tx, createForOrder } = setup();
    await svc.addUnit('j1', { newUnit: true, complaint: 'Cuci AC' }, 't1', 'teknisi');
    expect(createForOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ workAddress: undefined, workMapsUrl: undefined }));
  });
});

describe('TechnicianJobsService.addUnit — AC tanpa label (QR baru)', () => {
  it('membuat unit "QR dulu" milik pelanggan job, menambah hitungan AC member, dan minta cetak label + lengkapi data', async () => {
    const { svc, tx, acUnits, createForOrder } = setup();
    const r = await svc.addUnit(
      'j1',
      { newUnit: true, roomLocation: 'Kamar Anak', complaint: 'Cuci AC' },
      't1',
      'teknisi',
    );
    expect(acUnits.createLegacy).toHaveBeenCalledWith(tx, 'm1', {
      mode: 'qr_dulu',
      roomLocation: 'Kamar Anak',
    });
    expect(tx.member.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { totalAcUnits: { increment: 1 } },
    });
    expect(tx.memberAcUnit.findUnique).not.toHaveBeenCalled();
    expect(createForOrder).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ unitId: 'u9', orderId: 'o1', memberId: 'm1' }),
    );
    expect(r).toMatchObject({
      ok: true,
      jobId: 'j2',
      unitId: 'u9',
      barcodeValue: 'ACUNIT-20261104-0009',
      needsLabel: true,
      needsData: true,
    });
  });
});

describe('TechnicianJobsService.addUnit — syarat job & pemilik', () => {
  it.each(['assigned', 'sedang_dikerjakan'])(
    'job berstatus %s boleh ditambah unit (customer sering minta tambah AC sebelum job dimulai)',
    async (status) => {
      const { svc, createForOrder } = setup({ job: { status } });
      await svc.addUnit(
        'j1',
        { barcode: 'B', complaint: 'Cuci' },
        't1',
        'teknisi',
      );
      expect(createForOrder).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['menunggu_penugasan', 'menunggu_review', 'selesai', 'dibatalkan'])(
    'job berstatus %s ditolak',
    async (status) => {
      const { svc, createForOrder } = setup({ job: { status } });
      await expect(
        svc.addUnit('j1', { barcode: 'B', complaint: 'Cuci' }, 't1', 'teknisi'),
      ).rejects.toThrow(
        /hanya bisa ditambahkan saat job Ditugaskan atau Sedang Dikerjakan/,
      );
      expect(createForOrder).not.toHaveBeenCalled();
    },
  );

  it('order pemasangan (POS) ditolak', async () => {
    const { svc } = setup({ job: { type: 'pemasangan' } });
    await expect(
      svc.addUnit('j1', { barcode: 'B', complaint: 'Cuci' }, 't1', 'teknisi'),
    ).rejects.toThrow(/pemasangan/);
  });

  it('teknisi lain (bukan pemilik job) ditolak, admin boleh', async () => {
    const a = setup();
    await expect(
      a.svc.addUnit(
        'j1',
        { barcode: 'B', complaint: 'Cuci' },
        't-lain',
        'teknisi',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(a.createForOrder).not.toHaveBeenCalled();

    const b = setup();
    await b.svc.addUnit(
      'j1',
      { barcode: 'B', complaint: 'Cuci' },
      'admin1',
      'admin',
    );
    // job tetap dipegang teknisi pemilik job, bukan admin
    expect(b.createForOrder).toHaveBeenCalledWith(
      b.tx,
      expect.objectContaining({ technicianIds: ['t1'], actorId: 'admin1' }),
    );
  });

  it('job tanpa pelanggan ditolak', async () => {
    const { svc } = setup({ job: { memberId: null, member: null } });
    await expect(
      svc.addUnit('j1', { barcode: 'B', complaint: 'Cuci' }, 't1', 'teknisi'),
    ).rejects.toThrow(/tidak punya pelanggan/);
  });
});

describe('TechnicianJobsService.addUnit — validasi masukan (sebelum menyentuh database)', () => {
  it.each([
    [
      'keluhan kosong',
      { barcode: 'B', complaint: '   ' },
      /pekerjaan\/keluhan/,
    ],
    ['keluhan tidak dikirim', { barcode: 'B' }, /pekerjaan\/keluhan/],
    [
      'dua jalur sekaligus',
      { barcode: 'B', newUnit: true, complaint: 'Cuci' },
      /jangan dua-duanya/,
    ],
    [
      'tidak memilih jalur',
      { complaint: 'Cuci' },
      /Scan barcode unit yang sudah berlabel/,
    ],
    [
      'ruangan untuk unit berlabel',
      { barcode: 'B', roomLocation: 'Kamar', complaint: 'Cuci' },
      /Ruangan hanya diisi untuk AC tanpa label/,
    ],
  ])('%s ditolak', async (_name, dto, msg) => {
    const { svc, prisma } = setup();
    await expect(
      svc.addUnit('j1', dto as any, 't1', 'teknisi'),
    ).rejects.toThrow(msg);
    await expect(
      svc.addUnit('j1', dto as any, 't1', 'teknisi'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('TechnicianJobsService.unitLabels — data label untuk cetak oleh teknisi', () => {
  function labelsSetup(job: Record<string, unknown> = {}) {
    const prisma: any = {
      technicianJobAssignee: ownerAssignee,
      technicianJob: {
        findUnique: jest.fn(async () => ({
          orderId: 'o1',
          technicianId: 't1',
          member: { id: 'm1', name: 'Bu Sari' },
          ...job,
        })),
        // Titik lokasi kerja per unit (kosong = ikut alamat member): lihat technician-jobs.unit-labels.spec.ts.
        findMany: jest.fn(async () => []),
      },
      serviceOrderUnit: {
        findMany: jest.fn(async () => [
          {
            id: 'ou1',
            unitId: 'u9',
            unit: { id: 'u9', barcodeValue: 'ACUNIT-20261104-0009' },
          },
        ]),
      },
    };
    return {
      svc: new TechnicianJobsService(
        prisma,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      ),
      prisma,
    };
  }

  it('teknisi pemilik: hanya unit yang job-nya miliknya, bentuk sama dengan detail order untuk cetak label', async () => {
    const { svc, prisma } = labelsSetup();
    const r = await svc.unitLabels('j1', 't1', 'teknisi', ['u9']);
    expect(prisma.serviceOrderUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId: 'o1',
          unitId: { in: ['u9'] },
          unit: {
            technicianJobs: { some: { orderId: 'o1', assignees: { some: { technicianId: 't1' } } } },
          },
        },
      }),
    );
    expect(r).toEqual({
      id: 'o1',
      member: { id: 'm1', name: 'Bu Sari' },
      serviceOrderUnits: [
        { id: 'ou1', unit: { id: 'u9', barcodeValue: 'ACUNIT-20261104-0009' }, workAddress: null },
      ],
    });
  });

  it('admin melihat semua unit order (tanpa saringan pemilik); teknisi lain ditolak', async () => {
    const a = labelsSetup();
    await a.svc.unitLabels('j1', 'admin1', 'admin');
    expect(a.prisma.serviceOrderUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'o1' } }),
    );

    const b = labelsSetup();
    await expect(
      b.svc.unitLabels('j1', 't-lain', 'teknisi'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(b.prisma.serviceOrderUnit.findMany).not.toHaveBeenCalled();
  });

  it('job tidak ada: 404', async () => {
    const { svc, prisma } = labelsSetup();
    prisma.technicianJob.findUnique.mockResolvedValueOnce(null);
    await expect(svc.unitLabels('x', 't1', 'teknisi')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
