import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';

// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Order "Jumlah unit, teknisi yang scan": job slot tanpa unit (unitId null) yang diisi teknisi lewat scan barcode.
// Dijaga: slot terisi berurutan & hanya milik teknisinya, unit pelanggan lain/unit ganda/unit sibuk ditolak, scan itu
// dihitung sebagai scan Mulai Job, slot kosong menahan Ajukan Selesai/Setujui, dan satu tombol membatalkan seluruh order.

const ownerAssignee = {
  count: jest.fn(async ({ where }: any) => (where.technicianId === 't1' ? 1 : 0)),
};

function makeSvc(prisma: any) {
  return new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
}

function claimSetup(
  opts: {
    slots?: { id: string; assignees: { technicianId: string }[] }[];
    unit?: Record<string, unknown> | null;
    alreadyHere?: number;
    busy?: unknown[];
    orderUnit?: { id: string } | null;
  } = {},
) {
  const job = { id: 'j1', orderId: 'o1', memberId: 'm1', status: 'assigned', unitId: null };
  const slots = opts.slots ?? [
    { id: 's1', memberId: 'm1', assignees: [{ technicianId: 't1' }] },
    { id: 's2', memberId: 'm1', assignees: [{ technicianId: 't1' }] },
  ];
  const unit =
    opts.unit === null
      ? null
      : { id: 'u7', memberId: 'm1', barcodeValue: 'ACUNIT-20261001-0007', status: 'aktif', ...opts.unit };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    technicianJobAssignee: ownerAssignee,
    technicianJob: {
      findUnique: jest.fn(async () => job),
      // findMany dipakai dua kali: daftar slot kosong (unitId: null) dan pengecekan unit sibuk (assertNoActiveJob).
      findMany: jest.fn(async ({ where }: any) =>
        where.unitId === null ? slots.map((s) => ({ memberId: 'm1', ...s })) : (opts.busy ?? []),
      ),
      count: jest.fn(async () => opts.alreadyHere ?? 0),
      update: jest.fn(async () => ({})),
    },
    memberAcUnit: { findUnique: jest.fn(async () => unit) },
    serviceOrderUnit: {
      findFirst: jest.fn(async () => opts.orderUnit ?? null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { svc: makeSvc(prisma), tx };
}

describe('TechnicianJobsService.claimUnit — teknisi mengisi slot unit dengan scan', () => {
  it('mengisi slot kosong PERTAMA: unit terpasang, baris unit order dibuat, jejak scan dicatat', async () => {
    const { svc, tx } = claimSetup();
    const res = await svc.claimUnit('j1', { barcode: ' ACUNIT-20261001-0007 ' }, 't1', 'teknisi');
    expect(tx.technicianJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ unitId: 'u7' }) }),
    );
    expect(tx.serviceOrderUnit.create).toHaveBeenCalledWith({
      data: { orderId: 'o1', unitId: 'u7', status: 'terjadwal' },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'job.claim_unit', target: 's1' });
    expect(res).toMatchObject({ ok: true, jobId: 's1', unitId: 'u7', needsData: false, remainingSlots: 1 });
  });

  it('unit "QR dulu" (menunggu_data) boleh discan tetapi ditandai needsData', async () => {
    const { svc } = claimSetup({ unit: { status: 'menunggu_data' } });
    const res = await svc.claimUnit('j1', { barcode: 'ACUNIT-20261001-0007' }, 't1', 'teknisi');
    expect(res.needsData).toBe(true);
  });

  it('unit milik pelanggan lain DITOLAK, tidak ada yang berubah', async () => {
    const { svc, tx } = claimSetup({ unit: { memberId: 'm-lain' } });
    await expect(svc.claimUnit('j1', { barcode: 'X' }, 't1', 'teknisi')).rejects.toThrow(/pelanggan lain/);
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
    expect(tx.serviceOrderUnit.create).not.toHaveBeenCalled();
  });

  it('QR tidak dikenal: 404', async () => {
    const { svc } = claimSetup({ unit: null });
    await expect(svc.claimUnit('j1', { barcode: 'NGAWUR' }, 't1', 'teknisi')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unit yang sudah ada di order ini ditolak (tidak boleh dobel)', async () => {
    const { svc } = claimSetup({ alreadyHere: 1 });
    await expect(svc.claimUnit('j1', { barcode: 'X' }, 't1', 'teknisi')).rejects.toThrow(/sudah ada di job ini/);
  });

  it('unit yang masih punya job aktif di tempat lain ditolak', async () => {
    const { svc } = claimSetup({
      busy: [{ unit: { brand: 'LG', model: null, roomLocation: 'Lantai 2', barcodeValue: 'ACUNIT-1' } }],
    });
    await expect(svc.claimUnit('j1', { barcode: 'X' }, 't1', 'teknisi')).rejects.toThrow(/masih punya job servis/);
  });

  it('tidak ada slot kosong: ditolak jelas', async () => {
    const { svc } = claimSetup({ slots: [] });
    await expect(svc.claimUnit('j1', { barcode: 'X' }, 't1', 'teknisi')).rejects.toThrow(/Tidak ada slot unit yang kosong/);
  });

  it('teknisi hanya mengisi slot MILIKNYA: slot yang dipegang teknisi lain tidak terhitung', async () => {
    const { svc } = claimSetup({ slots: [{ id: 's9', assignees: [{ technicianId: 't2' }] }] });
    await expect(svc.claimUnit('j1', { barcode: 'X' }, 't1', 'teknisi')).rejects.toThrow(/Tidak ada slot unit yang kosong/);
  });

  it('admin boleh mengisi slot milik teknisi mana pun', async () => {
    const { svc, tx } = claimSetup({ slots: [{ id: 's9', assignees: [{ technicianId: 't2' }] }] });
    await svc.claimUnit('j1', { barcode: 'X' }, 'a1', 'admin');
    expect(tx.technicianJob.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's9' } }));
  });

  it('teknisi lain (bukan assignee job yang dipindai) ditolak 403', async () => {
    const { svc } = claimSetup();
    await expect(svc.claimUnit('j1', { barcode: 'X' }, 't9', 'teknisi')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('barcode kosong ditolak', async () => {
    const { svc } = claimSetup();
    await expect(svc.claimUnit('j1', { barcode: '   ' }, 't1', 'teknisi')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('unit pernah ada di order ini (jobnya dibatalkan): barisnya dipakai ulang, bukan dobel', async () => {
    const { svc, tx } = claimSetup({ orderUnit: { id: 'ou1' } });
    await svc.claimUnit('j1', { barcode: 'X' }, 't1', 'teknisi');
    expect(tx.serviceOrderUnit.update).toHaveBeenCalledWith({ where: { id: 'ou1' }, data: { status: 'terjadwal' } });
    expect(tx.serviceOrderUnit.create).not.toHaveBeenCalled();
  });
});

describe('TechnicianJobsService.start — scan pengisi slot sudah dihitung (tanpa scan ulang)', () => {
  function startSetup(opts: { claimAt?: Date | null; handoverAfter?: number; job?: Record<string, unknown> }) {
    const job = {
      id: 'j1',
      orderId: 'o1',
      unitId: 'u7',
      type: 'cuci',
      status: 'assigned',
      startedAt: null,
      unit: { barcodeValue: 'BC-7', status: 'aktif' },
      ...opts.job,
    };
    const tx: any = {
      technicianJob: { update: jest.fn(async ({ data }: any) => ({ ...job, ...data })) },
      serviceOrderUnit: { updateMany: jest.fn(async () => ({ count: 1 })) },
      memberAcUnit: { update: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      technicianJobAssignee: { count: jest.fn(async () => 1) },
      technicianJob: { findUnique: jest.fn(async () => job) },
      jobFindingPhoto: { count: jest.fn(async () => 1) },
      auditLog: { findFirst: jest.fn(async () => (opts.claimAt ? { at: opts.claimAt } : null)) },
      jobHandover: { count: jest.fn(async () => opts.handoverAfter ?? 0) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { svc: makeSvc(prisma), tx, prisma };
  }

  it('unit hasil scan pengisi slot: Mulai Job tanpa barcode berhasil', async () => {
    const { svc, tx } = startSetup({ claimAt: new Date('2026-11-19T08:00:00Z') });
    const res: any = await svc.start('j1', undefined, 't1', 'teknisi');
    expect(res.status).toBe('sedang_dikerjakan');
    expect(tx.technicianJob.update).toHaveBeenCalled();
  });

  it('job biasa (tanpa jejak scan pengisi slot): scan tetap wajib', async () => {
    const { svc } = startSetup({ claimAt: null });
    await expect(svc.start('j1', undefined, 't1', 'teknisi')).rejects.toThrow(/Scan barcode unit diperlukan/);
    await expect(svc.start('j1', 'SALAH', 't1', 'teknisi')).rejects.toThrow(/Barcode tidak sesuai/);
  });

  it('dialihkan ke teknisi lain SESUDAH scan itu: teknisi baru wajib scan sendiri', async () => {
    const { svc } = startSetup({ claimAt: new Date('2026-11-19T08:00:00Z'), handoverAfter: 1 });
    await expect(svc.start('j1', undefined, 't1', 'teknisi')).rejects.toThrow(/Scan barcode unit diperlukan/);
  });

  it('job yang sudah pernah dimulai (dikembalikan ke assigned lewat alih tugas): tidak dibebaskan dari scan', async () => {
    const { svc } = startSetup({ claimAt: new Date('2026-11-19T08:00:00Z'), job: { startedAt: new Date() } });
    await expect(svc.start('j1', undefined, 't1', 'teknisi')).rejects.toThrow(/Scan barcode unit diperlukan/);
  });

  it('slot yang unitnya belum discan: Mulai Job ditolak dengan petunjuk scan', async () => {
    const { svc } = startSetup({ job: { unitId: null, unit: null } });
    await expect(svc.start('j1', 'APA-SAJA', 't1', 'teknisi')).rejects.toThrow(/Unit belum discan/);
  });
});

describe('slot yang belum discan: temuan, foto, dan pengajuan ditahan', () => {
  function slotPrisma(extra: Record<string, unknown> = {}) {
    const slot = { id: 's1', orderId: 'o1', unitId: null, status: 'assigned', technicianId: 't1' };
    const prisma: any = {
      technicianJobAssignee: ownerAssignee,
      technicianJob: { findUnique: jest.fn(async () => slot) },
      jobFinding: { findUnique: jest.fn(async () => ({ id: 'f1', jobId: 's1' })) },
      ...extra,
    };
    return makeSvc(prisma);
  }

  it('tambah temuan / deskripsi temuan / foto pada slot kosong ditolak', async () => {
    const svc = slotPrisma();
    await expect(svc.addFinding('s1', { categoryName: 'Bocor' }, 't1', 'teknisi')).rejects.toThrow(/Unit belum discan/);
    await expect(svc.updateFindingNote('s1', 'f1', 'x', 't1', 'teknisi')).rejects.toThrow(/Unit belum discan/);
    await expect(svc.addFindingPhoto('s1', 'f1', 'sebelum', '/uploads/x.jpg', 't1', 'teknisi')).rejects.toThrow(
      /Unit belum discan/,
    );
  });

  it('Ajukan Selesai seluruh order ditolak selama masih ada slot kosong, pesan menyebut jumlahnya', async () => {
    const jobs = [
      { id: 'j1', orderId: 'o1', unitId: 'u1', status: 'sedang_dikerjakan', unit: { barcodeValue: 'B1' } },
      { id: 's1', orderId: 'o1', unitId: null, status: 'assigned', unit: null },
      { id: 's2', orderId: 'o1', unitId: null, status: 'assigned', unit: null },
    ];
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      technicianJob: { findMany: jest.fn(async () => jobs), update: jest.fn() },
    };
    const prisma: any = {
      technicianJobAssignee: ownerAssignee,
      technicianJob: { findUnique: jest.fn(async () => ({ id: 'j1', orderId: 'o1' })) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const svc = makeSvc(prisma);
    await expect(svc.submitForReview('j1', 't1', 'teknisi', { allInOrder: true })).rejects.toThrow(
      /2 slot unit yang belum discan/,
    );
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
  });

  it('Setujui seluruh order ditolak selama masih ada slot kosong', async () => {
    const jobs = [
      { id: 'j1', orderId: 'o1', unitId: 'u1', status: 'menunggu_review', type: 'cuci', unit: { barcodeValue: 'B1' } },
      { id: 's1', orderId: 'o1', unitId: null, status: 'assigned', type: 'cuci', unit: null },
    ];
    const prisma: any = {
      technicianJob: {
        findUnique: jest.fn(async () => ({ orderId: 'o1' })),
        findMany: jest.fn(async () => jobs),
      },
    };
    const svc = makeSvc(prisma);
    await expect(svc.approveComplete('j1', 'admin', { allInOrder: true })).rejects.toThrow(
      /1 slot unit yang belum discan/,
    );
  });
});

describe('TechnicianJobsService.cancel — allInOrder (batalkan seluruh order dengan satu tombol)', () => {
  function cancelSetup(jobs: any[]) {
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      technicianJob: { findMany: jest.fn(async () => jobs) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      technicianJob: {
        findUnique: jest.fn(async () => ({ orderId: 'o1' })),
        findUniqueOrThrow: jest.fn(async () => ({ id: 'j1', status: 'dibatalkan', technicianId: 't1' })),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const svc = makeSvc(prisma);
    const inTx = jest.spyOn(svc as any, 'cancelJobInTx').mockResolvedValue({});
    return { svc, tx, inTx };
  }

  it('membatalkan semua job yang belum selesai/dibatalkan (termasuk slot kosong), satu audit, tanpa pindah harga', async () => {
    const jobs = [
      { id: 'j1', assignees: [{ technicianId: 't1' }] },
      { id: 'j2', assignees: [{ technicianId: 't1' }, { technicianId: 't2' }] },
      { id: 's1', assignees: [{ technicianId: 't1' }] },
    ];
    const { svc, tx, inTx } = cancelSetup(jobs);
    const res: any = await svc.cancel('j1', 'a1', 'admin', { allInOrder: true });
    expect(inTx).toHaveBeenCalledTimes(3);
    for (const call of inTx.mock.calls) expect(call[3]).toEqual({ skipSuccessor: true });
    // Yang diambil hanya job yang belum selesai/dibatalkan.
    expect(tx.technicianJob.findMany.mock.calls[0][0].where.status).toEqual({ notIn: ['selesai', 'dibatalkan'] });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'job.cancel_order', target: 'o1' });
    expect(res).toMatchObject({ cancelledCount: 3, cancelledJobIds: ['j1', 'j2', 's1'] });
    // Teknisi dikabari sekali per orang, bukan per unit.
    expect(res.technicianIds.sort()).toEqual(['t1', 't2']);
  });

  it('tidak ada yang bisa dibatalkan (semua selesai/dibatalkan): ditolak jelas', async () => {
    const { svc, inTx } = cancelSetup([]);
    await expect(svc.cancel('j1', 'a1', 'admin', { allInOrder: true })).rejects.toThrow(/Tidak ada unit yang bisa dibatalkan/);
    expect(inTx).not.toHaveBeenCalled();
  });

  it('hanya admin', async () => {
    const { svc } = cancelSetup([{ id: 'j1', assignees: [] }]);
    await expect(svc.cancel('j1', 't1', 'teknisi', { allInOrder: true })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
