import { BadRequestException } from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';

// Guard akses job kini berbasis tabel assignees (semua teknisi job setara); di tes ini pemilik job = 't1'.
const ownerAssignee = {
  count: jest.fn(async ({ where }: any) => (where.technicianId === 't1' ? 1 : 0)),
};


// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Servis banyak AC = satu order, satu job per unit, satu invoice bersama. Yang dijaga di sini: harga jasa harus
// per unit (bukan sekadar "invoice order sudah ada"), saudara job ikut terkirim ke halaman job, dan penugasan
// teknisi bisa serentak untuk seluruh order.

const photos = [{ kind: 'sebelum' }, { kind: 'sesudah' }];

function submitSetup(opts: { job?: Record<string, unknown>; invoiceId?: string | null; siblingJobs?: number }) {
  const job = {
    id: 'j1',
    orderId: 'o1',
    status: 'sedang_dikerjakan',
    technicianId: 't1',
    type: 'perbaikan',
    billingDerived: false,
    ...opts.job,
  };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    technicianJobAssignee: ownerAssignee,
    technicianJob: {
      findUnique: jest.fn(async () => job),
      count: jest.fn(async () => opts.siblingJobs ?? 0),
      update: jest.fn(async ({ data }: any) => ({ ...job, ...data })),
    },
    jobFinding: { findMany: jest.fn(async () => [{ title: 'AC bocor', photos }]) },
    materialRequest: { count: jest.fn(async () => 0) },
    serviceOrder: {
      findUnique: jest.fn(async () => ({ invoiceId: opts.invoiceId === undefined ? 'inv1' : opts.invoiceId })),
    },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, tx };
}

describe('TechnicianJobsService.submitForReview — harga jasa BUKAN syarat pengajuan (admin menetapkannya saat review)', () => {
  it('belum ada invoice sama sekali: teknisi tetap bisa mengajukan selesai', async () => {
    const { svc, tx } = submitSetup({ invoiceId: null });
    await svc.submitForReview('j1', 'a1', 'admin');
    expect(tx.technicianJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'menunggu_review' }) }),
    );
  });

  it('order banyak unit: unit yang belum dihargai tetap bisa diajukan', async () => {
    const { svc, tx } = submitSetup({ siblingJobs: 2 });
    await svc.submitForReview('j1', 'a1', 'admin');
    expect(tx.technicianJob.update).toHaveBeenCalled();
  });
});

describe('TechnicianJobsService.approveComplete — gate harga jasa (pindahan dari pengajuan), pembayaran tidak dicek', () => {
  function approveGateSetup(opts: { job?: Record<string, unknown>; invoiceId?: string | null; siblingJobs?: number }) {
    const job = {
      id: 'j1',
      orderId: 'o1',
      status: 'menunggu_review',
      technicianId: 't1',
      type: 'perbaikan',
      billingDerived: false,
      unitId: null,
      ...opts.job,
    };
    const prisma: any = {
      technicianJobAssignee: ownerAssignee,
      technicianJob: {
        findUnique: jest.fn(async () => job),
        count: jest.fn(async () => opts.siblingJobs ?? 0),
      },
      serviceOrder: {
        findUnique: jest.fn(async () => ({ invoiceId: opts.invoiceId === undefined ? 'inv1' : opts.invoiceId })),
      },
      $transaction: jest.fn(async () => {
        throw new Error('seharusnya tidak sampai transaksi');
      }),
    };
    const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('belum ada invoice: admin tidak bisa menyetujui selesai', async () => {
    const { svc, prisma } = approveGateSetup({ invoiceId: null });
    await expect(svc.approveComplete('j1', 'admin')).rejects.toThrow(/Harga jasa belum ditetapkan/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('order banyak unit: unit yang belum dihargai ditolak walau invoice order sudah ada', async () => {
    const { svc, prisma } = approveGateSetup({ siblingJobs: 2 });
    await expect(svc.approveComplete('j1', 'admin')).rejects.toThrow(/Harga jasa untuk unit ini belum ditetapkan/);
    // saudara dihitung tanpa job dirinya sendiri dan tanpa yang dibatalkan
    expect(prisma.technicianJob.count).toHaveBeenCalledWith({
      where: { orderId: 'o1', id: { not: 'j1' }, status: { not: 'dibatalkan' } },
    });
  });

  it('pemasangan (invoice dari POS) tidak diwajibkan punya harga jasa per unit', async () => {
    const { svc, prisma } = approveGateSetup({ siblingJobs: 2, job: { type: 'pemasangan' } });
    // lolos gate harga -> lanjut ke transaksi (di-mock melempar), bukan error harga
    await expect(svc.approveComplete('j1', 'admin', { reminderEnabled: false })).rejects.not.toThrow(/Harga jasa/);
    expect(prisma.technicianJob.count).not.toHaveBeenCalled();
  });

  it('sudah dihargai: gate harga lolos tanpa melihat status pembayaran invoice', async () => {
    const { svc, prisma } = approveGateSetup({ job: { billingDerived: true } });
    await expect(svc.approveComplete('j1', 'admin')).rejects.toThrow(/seharusnya tidak sampai transaksi/);
    expect(prisma.serviceOrder.findUnique).toHaveBeenCalledWith({ where: { id: 'o1' }, select: { invoiceId: true } });
  });
});

describe('TechnicianJobsService.updateFindingNote — deskripsi per temuan', () => {
  function noteSetup(over: { status?: string; findingJobId?: string } = {}) {
    const prisma: any = {
      technicianJobAssignee: ownerAssignee,
      technicianJob: {
        findUnique: jest.fn(async () => ({ id: 'j1', technicianId: 't1', status: over.status ?? 'sedang_dikerjakan' })),
      },
      jobFinding: {
        findUnique: jest.fn(async () => ({ id: 'f1', jobId: over.findingJobId ?? 'j1' })),
        update: jest.fn(async ({ data }: any) => ({ id: 'f1', ...data })),
      },
    };
    return { svc: new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any), prisma };
  }

  it('teknisi pemilik menyimpan deskripsi (dipangkas); kosong = dihapus', async () => {
    const { svc, prisma } = noteSetup();
    await svc.updateFindingNote('j1', 'f1', '  Freon bocor di sambungan  ', 't1', 'teknisi');
    expect(prisma.jobFinding.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { note: 'Freon bocor di sambungan' } });
    await svc.updateFindingNote('j1', 'f1', '   ', 't1', 'teknisi');
    expect(prisma.jobFinding.update).toHaveBeenLastCalledWith({ where: { id: 'f1' }, data: { note: null } });
  });

  it('ditolak: job tidak aktif, temuan milik job lain, teknisi lain', async () => {
    await expect(noteSetup({ status: 'menunggu_review' }).svc.updateFindingNote('j1', 'f1', 'x', 't1', 'teknisi')).rejects.toThrow(
      /hanya bisa diubah saat job aktif/,
    );
    await expect(noteSetup({ findingJobId: 'j9' }).svc.updateFindingNote('j1', 'f1', 'x', 't1', 'teknisi')).rejects.toThrow(
      /Temuan tidak ditemukan/,
    );
    await expect(noteSetup().svc.updateFindingNote('j1', 'f1', 'x', 't-lain', 'teknisi')).rejects.toThrow(/bukan milik Anda/);
  });
});

describe('TechnicianJobsService.deleteFindingPhoto — hapus foto temuan', () => {
  function photoSetup(over: { status?: string; photoFindingId?: string; photoJobId?: string } = {}) {
    const prisma: any = {
      technicianJobAssignee: ownerAssignee,
      technicianJob: {
        findUnique: jest.fn(async () => ({ id: 'j1', technicianId: 't1', status: over.status ?? 'sedang_dikerjakan' })),
      },
      jobFindingPhoto: {
        findUnique: jest.fn(async () => ({
          id: 'p1',
          path: '/uploads/job-photos/tidak-ada.jpg',
          finding: { id: over.photoFindingId ?? 'f1', jobId: over.photoJobId ?? 'j1' },
        })),
        delete: jest.fn(async () => ({})),
      },
    };
    return { svc: new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any), prisma };
  }

  it('teknisi pemilik menghapus foto; file yang sudah hilang di disk tidak menggagalkan', async () => {
    const { svc, prisma } = photoSetup();
    await expect(svc.deleteFindingPhoto('j1', 'f1', 'p1', 't1', 'teknisi')).resolves.toEqual({ ok: true });
    expect(prisma.jobFindingPhoto.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  it('ditolak: job tidak aktif, foto bukan milik temuan/job ini, teknisi lain', async () => {
    const a = photoSetup({ status: 'menunggu_review' });
    await expect(a.svc.deleteFindingPhoto('j1', 'f1', 'p1', 't1', 'teknisi')).rejects.toThrow(/saat job aktif/);
    const b = photoSetup({ photoFindingId: 'f9' });
    await expect(b.svc.deleteFindingPhoto('j1', 'f1', 'p1', 't1', 'teknisi')).rejects.toThrow(/Foto tidak ditemukan/);
    const c = photoSetup({ photoJobId: 'j9' });
    await expect(c.svc.deleteFindingPhoto('j1', 'f1', 'p1', 't1', 'teknisi')).rejects.toThrow(/Foto tidak ditemukan/);
    const d = photoSetup();
    await expect(d.svc.deleteFindingPhoto('j1', 'f1', 'p1', 't-lain', 'teknisi')).rejects.toThrow(/bukan milik Anda/);
    for (const s of [a, b, c, d]) expect(s.prisma.jobFindingPhoto.delete).not.toHaveBeenCalled();
  });
});

function findOneSetup(orderType: string) {
  const job = {
    id: 'j1',
    orderId: 'o1',
    technicianId: 't1',
    unit: null,
    order: { type: orderType, invoice: null },
    assignees: [{ technician: { id: 't1', displayName: 'Ani' } }],
  };
  const siblingRows = [{ id: 'j2', createdAt: new Date('2026-11-03') }];
  const prisma: any = {
    technicianJobAssignee: ownerAssignee,
    technicianJob: {
      findUnique: jest.fn(async () => job),
      findMany: jest.fn(async () => siblingRows),
    },
  };
  const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, prisma, siblingRows };
}

describe('TechnicianJobsService.findOne — job saudara (servis banyak AC)', () => {
  it('admin: semua job lain di order yang sama', async () => {
    const { svc, prisma, siblingRows } = findOneSetup('perbaikan');
    const res: any = await svc.findOne('j1', 'a1', 'admin');
    expect(res.siblings).toEqual(siblingRows);
    expect(prisma.technicianJob.findMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', id: { not: 'j1' } },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('teknisi: hanya saudara yang ditugaskan ke dirinya (job teknisi lain 403 kalau dibuka)', async () => {
    const { svc, prisma } = findOneSetup('perbaikan');
    await svc.findOne('j1', 't1', 'teknisi');
    expect(prisma.technicianJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'o1', id: { not: 'j1' }, assignees: { some: { technicianId: 't1' } } } }),
    );
  });

  it('order pemasangan tidak digabung: siklus instalasi POS tetap satu halaman per job', async () => {
    const { svc, prisma } = findOneSetup('pemasangan');
    const res: any = await svc.findOne('j1', 'a1', 'admin');
    expect(res.siblings).toEqual([]);
    expect(prisma.technicianJob.findMany).not.toHaveBeenCalled();
  });
});

describe('TechnicianJobsService.assign — penugasan & alih tugas', () => {
  type J = { id: string; orderId: string; status: string; technicianId: string | null };
  function assignSetup(jobList: J[]) {
    const jobs = new Map(jobList.map((j) => [j.id, { ...j }]));
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      // Teknisi job disimulasikan dari kolom technicianId (satu teknisi per job di blok tes ini; set penuh diuji di assignees.spec).
      technicianJobAssignee: {
        findMany: jest.fn(async ({ where }: any) =>
          [...jobs.values()].filter((j) => where.jobId.in.includes(j.id) && j.technicianId).map((j) => ({ jobId: j.id, technicianId: j.technicianId })),
        ),
        deleteMany: jest.fn(async () => ({})),
        createMany: jest.fn(async () => ({})),
      },
      technicianJob: {
        findUnique: jest.fn(async ({ where }: any) => (jobs.has(where.id) ? { ...jobs.get(where.id)! } : null)), // salinan, seperti baris dari DB
        findMany: jest.fn(async ({ where }: any) =>
          [...jobs.values()]
            .filter((j) => j.orderId === where.orderId && j.id !== where.id.not && where.status.in.includes(j.status))
            .map((j) => ({ ...j })),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          Object.assign(jobs.get(where.id)!, data);
          return { ...jobs.get(where.id) };
        }),
      },
      user: {
        findMany: jest.fn(async () => [
          { id: 't1', displayName: 'Andi' },
          { id: 't9', displayName: 'Citra' },
        ]),
      },
      jobHandover: { create: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      user: { findMany: jest.fn(async () => [{ id: 't9', role: 'teknisi', active: true }]) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma, tx };
  }
  const opts = { actorId: 'adm1', role: 'admin' as const };
  const job = (id: string, status: string, technicianId: string | null = 't1'): J => ({ id, orderId: 'o1', status, technicianId });

  it('penugasan pertama (belum ada teknisi): jadi assigned, TIDAK dicatat sebagai alih tugas', async () => {
    const { svc, tx } = assignSetup([job('j1', 'menunggu_penugasan', null)]);
    const res: any = await svc.assign('j1', ['t9'], opts);
    expect(res.status).toBe('assigned');
    expect(res.previousTechnicianIds).toEqual([]);
    expect(tx.jobHandover.create).not.toHaveBeenCalled();
  });

  it('ganti teknisi sebelum mulai: tetap assigned dan alih tugas tercatat dengan alasannya', async () => {
    const { svc, tx } = assignSetup([job('j1', 'assigned')]);
    const res: any = await svc.assign('j1', ['t9'], { ...opts, reason: '  Teknisi sakit ' });
    expect(res.technicianId).toBe('t9');
    expect(res.previousTechnicianIds).toEqual(['t1']);
    expect(tx.jobHandover.create).toHaveBeenCalledWith({
      data: {
        jobId: 'j1',
        fromTechnicianId: 't1',
        toTechnicianId: 't9',
        handedById: 'adm1',
        statusAtHandover: 'assigned',
        reason: 'Teknisi sakit',
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'job.handover',
          target: 'j1',
          detail: expect.objectContaining({ dari: 'Andi', ke: 'Citra', reason: 'Teknisi sakit' }),
        }),
      }),
    );
  });

  it('job SUDAH dikerjakan (sedang_dikerjakan) boleh dialihkan admin: kembali ke assigned (wajib scan ulang), teknisi lama tercatat', async () => {
    const { svc, tx } = assignSetup([job('j1', 'sedang_dikerjakan')]);
    const res: any = await svc.assign('j1', ['t9'], opts);
    expect(res.status).toBe('assigned');
    expect(res.technicianId).toBe('t9');
    expect(tx.jobHandover.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ statusAtHandover: 'sedang_dikerjakan', reason: null }),
    });
  });

  it('kasir TIDAK boleh mengalihkan job yang sedang dikerjakan / menunggu review, tapi boleh mengganti teknisi sebelum mulai', async () => {
    const kasir = { actorId: 'k1', role: 'kasir' as const };
    for (const status of ['sedang_dikerjakan', 'menunggu_review']) {
      const busy = assignSetup([job('j1', status)]);
      await expect(busy.svc.assign('j1', ['t9'], kasir)).rejects.toThrow(/Hanya admin yang boleh mengalihkan/);
      expect(busy.tx.technicianJob.update).not.toHaveBeenCalled();
    }
    const idle = assignSetup([job('j1', 'assigned')]);
    const res: any = await idle.svc.assign('j1', ['t9'], kasir);
    expect(res.technicianId).toBe('t9');
  });

  it('kasir allInOrder ditolak seluruhnya kalau ada unit yang sedang dikerjakan', async () => {
    const { svc, tx } = assignSetup([job('j1', 'assigned'), job('j2', 'sedang_dikerjakan')]);
    await expect(svc.assign('j1', ['t9'], { actorId: 'k1', role: 'kasir', allInOrder: true })).rejects.toThrow(/Hanya admin/);
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
  });

  it('job yang sedang dikerjakan teknisi yang sama ditolak (bukan alih tugas)', async () => {
    const { svc, tx } = assignSetup([job('j1', 'sedang_dikerjakan', 't9')]);
    await expect(svc.assign('j1', ['t9'], opts)).rejects.toThrow(/sudah dipegang teknisi tersebut/);
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
  });

  it('job menunggu_review boleh dialihkan admin TANPA dikembalikan: tetap menunggu_review (tanpa scan ulang), admin tetap bisa menyetujui', async () => {
    const { svc, tx } = assignSetup([job('j1', 'menunggu_review')]);
    const res: any = await svc.assign('j1', ['t9'], opts);
    expect(res.status).toBe('menunggu_review');
    expect(res.technicianId).toBe('t9');
    expect(tx.jobHandover.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ statusAtHandover: 'menunggu_review', fromTechnicianId: 't1', toTechnicianId: 't9' }),
    });
  });

  it('job menunggu_review yang sudah dipegang teknisi tujuan ditolak', async () => {
    const { svc } = assignSetup([job('j1', 'menunggu_review', 't9')]);
    await expect(svc.assign('j1', ['t9'], opts)).rejects.toThrow(/sudah dipegang teknisi tersebut/);
  });

  it.each(['selesai', 'dibatalkan'])('job %s tidak bisa dialihkan', async (status) => {
    const { svc, tx } = assignSetup([job('j1', status)]);
    await expect(svc.assign('j1', ['t9'], opts)).rejects.toThrow(/tidak bisa di-assign ulang/);
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
  });

  it('allInOrder: semua unit yang belum selesai pindah (yang sedang jalan kembali ke assigned, yang menunggu review tetap), yang selesai tidak disentuh', async () => {
    const { svc, tx } = assignSetup([
      job('j1', 'sedang_dikerjakan'),
      job('j2', 'assigned'),
      job('j3', 'menunggu_review'),
      job('j4', 'selesai'),
      job('j5', 'sedang_dikerjakan', 't9'), // sudah di teknisi tujuan: dilewati
    ]);
    const res: any = await svc.assign('j1', ['t9'], { ...opts, allInOrder: true });
    const updates = tx.technicianJob.update.mock.calls
      .filter((c: any) => c[0].data.status)
      .map((c: any) => [c[0].where.id, c[0].data.status]);
    expect(updates).toEqual([
      ['j1', 'assigned'],
      ['j2', 'assigned'],
      ['j3', 'menunggu_review'],
    ]);
    expect(tx.jobHandover.create).toHaveBeenCalledTimes(3);
    expect(res.previousTechnicianIds).toEqual(['t1']);
  });

  it('teknisi tidak valid ditolak sebelum menyentuh job', async () => {
    const { svc, prisma, tx } = assignSetup([job('j1', 'assigned')]);
    prisma.user.findMany.mockResolvedValueOnce([{ id: 't9', role: 'kasir', active: true }]);
    await expect(svc.assign('j1', ['t9'], { ...opts, allInOrder: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// "Ajukan Selesai" / "Setujui" / "Kembalikan" untuk SELURUH order servis banyak AC (satu job, banyak unit).
// ---------------------------------------------------------------------------------------------------------------

const unitOf = (brand: string, room: string, code: string) => ({ brand, model: null, roomLocation: room, barcodeValue: code });
const baseJob = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  orderId: 'o1',
  status: 'sedang_dikerjakan',
  technicianId: 't1',
  type: 'perbaikan',
  billingDerived: true,
  createdAt: new Date(`2026-11-03T08:00:0${id.slice(1)}Z`),
  memberId: 'm1',
  unit: unitOf(id === 'j1' ? 'Daikin' : id === 'j2' ? 'Panasonic' : 'LG', `Ruang ${id}`, `BC-${id}`),
  ...over,
});
const goodFinding = [{ title: 'AC bocor', photos: [{ kind: 'sebelum' }, { kind: 'sesudah' }] }];

function orderSetup(jobList: Record<string, unknown>[], opts: { findings?: Record<string, unknown[]> } = {}) {
  const jobs: Record<string, any> = Object.fromEntries(jobList.map((j: any) => [j.id, j]));
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    technicianJobAssignee: ownerAssignee,
    technicianJob: {
      findMany: jest.fn(async () => Object.values(jobs).filter((j: any) => j.status !== 'dibatalkan')),
      findUnique: jest.fn(async ({ where }: any) => jobs[where.id] ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => jobs[where.id]),
      count: jest.fn(async () => Object.keys(jobs).length - 1),
      update: jest.fn(async ({ where, data }: any) => ({ ...jobs[where.id], ...data })),
    },
    jobFinding: { findMany: jest.fn(async ({ where }: any) => opts.findings?.[where.jobId] ?? goodFinding) },
    materialRequest: { count: jest.fn(async () => 0) },
    serviceOrder: { findUnique: jest.fn(async () => ({ invoiceId: 'inv1' })) },
  };
  const notifications: any = { notifyRoles: jest.fn(async () => undefined) };
  const prisma: any = {
    technicianJobAssignee: ownerAssignee,
    technicianJob: {
      findUnique: jest.fn(async ({ where }: any) => ({ ...jobs[where.id], technician: { displayName: 'Andi' }, member: { name: 'Budi' } })),
      findMany: tx.technicianJob.findMany,
      findUniqueOrThrow: tx.technicianJob.findUniqueOrThrow,
      updateMany: jest.fn(async () => ({ count: 2 })),
    },
    memberAcUnit: { findUnique: jest.fn(async () => ({ serviceIntervalDays: null })) },
    serviceOrder: tx.serviceOrder,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  prisma.technicianJob.count = tx.technicianJob.count;
  const svc = new TechnicianJobsService(prisma, {} as any, {} as any, notifications, {} as any, {} as any);
  return { svc, tx, prisma, notifications, jobs };
}

const updatedIds = (tx: any) => tx.technicianJob.update.mock.calls.map((c: any) => c[0].where.id);

describe('TechnicianJobsService.submitForReview — allInOrder (Ajukan Selesai satu kali untuk semua unit)', () => {
  it('semua unit memenuhi gate: semuanya pindah ke menunggu_review, satu notifikasi untuk admin', async () => {
    const { svc, tx, notifications } = orderSetup([baseJob('j1'), baseJob('j2'), baseJob('j3')]);
    const res: any = await svc.submitForReview('j2', 't1', 'teknisi', { allInOrder: true });
    expect(tx.technicianJob.update.mock.calls.map((c: any) => [c[0].where.id, c[0].data.status])).toEqual([
      ['j1', 'menunggu_review'],
      ['j2', 'menunggu_review'],
      ['j3', 'menunggu_review'],
    ]);
    expect(res.status).toBe('menunggu_review'); // yang dikembalikan = job yang dibuka (j2)
    await new Promise((r) => setImmediate(r));
    expect(notifications.notifyRoles).toHaveBeenCalledTimes(1);
    expect(notifications.notifyRoles.mock.calls[0][1].body).toContain('3 unit AC');
  });

  it('ada unit yang belum discan/dimulai: ditolak sebelum ada yang berubah, pesan menyebut unitnya', async () => {
    const { svc, tx } = orderSetup([baseJob('j1'), baseJob('j2', { status: 'assigned' })]);
    await expect(svc.submitForReview('j1', 't1', 'teknisi', { allInOrder: true })).rejects.toThrow(
      /belum discan\/dimulai: Panasonic \(Ruang j2\)/,
    );
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
  });

  it('satu unit gagal gate (foto sesudah kurang): seluruh pengajuan gagal dengan nama unitnya', async () => {
    const { svc } = orderSetup([baseJob('j1'), baseJob('j2')], {
      findings: { j2: [{ title: 'Bocor', photos: [{ kind: 'sebelum' }] }] },
    });
    await expect(svc.submitForReview('j1', 't1', 'teknisi', { allInOrder: true })).rejects.toThrow(
      /Unit Panasonic \(Ruang j2\): Temuan "Bocor" wajib punya foto SEBELUM dan SESUDAH/,
    );
  });

  it('unit yang harganya belum ditetapkan TIDAK menahan pengajuan (harga ditetapkan admin setelahnya)', async () => {
    const { svc, tx } = orderSetup([baseJob('j1'), baseJob('j2', { billingDerived: false })]);
    await svc.submitForReview('j1', 't1', 'teknisi', { allInOrder: true });
    expect(updatedIds(tx)).toEqual(['j1', 'j2']);
  });

  it('unit yang sudah diajukan dilewati, unit dibatalkan diabaikan', async () => {
    const { svc, tx } = orderSetup([
      baseJob('j1'),
      baseJob('j2', { status: 'menunggu_review' }),
      baseJob('j3', { status: 'dibatalkan' }),
    ]);
    await svc.submitForReview('j1', 't1', 'teknisi', { allInOrder: true });
    expect(updatedIds(tx)).toEqual(['j1']);
  });

  it('tidak ada unit yang bisa diajukan: ditolak jelas', async () => {
    const { svc } = orderSetup([baseJob('j1', { status: 'menunggu_review' })]);
    await expect(svc.submitForReview('j1', 't1', 'teknisi', { allInOrder: true })).rejects.toThrow(
      /Tidak ada unit yang bisa diajukan/,
    );
  });

  it('teknisi lain tidak boleh mengajukan order ini', async () => {
    const { svc } = orderSetup([baseJob('j1')]);
    await expect(svc.submitForReview('j1', 't-lain', 'teknisi', { allInOrder: true })).rejects.toThrow(/bukan milik Anda/);
  });

  it('tanpa allInOrder: tetap hanya satu job (perilaku lama)', async () => {
    const { svc, tx } = orderSetup([baseJob('j1'), baseJob('j2')]);
    await svc.submitForReview('j1', 't1', 'teknisi');
    expect(updatedIds(tx)).toEqual(['j1']);
  });
});

describe('TechnicianJobsService.approveComplete — allInOrder (setujui seluruh job sekaligus)', () => {
  function approveSetup(jobList: Record<string, unknown>[]) {
    const ctx = orderSetup(jobList);
    const real = ctx.svc.approveComplete.bind(ctx.svc);
    const spy = jest
      .spyOn(ctx.svc, 'approveComplete')
      .mockImplementation(async (id: string, role: any, dto: any) =>
        dto?.allInOrder ? real(id, role, dto) : ({ id, status: 'selesai' } as any),
      );
    const perUnitCalls = () => spy.mock.calls.filter((c: any) => !c[2]?.allInOrder);
    return { ...ctx, spy, perUnitCalls };
  }
  const waiting = (id: string, over: Record<string, unknown> = {}) => baseJob(id, { status: 'menunggu_review', ...over });

  it('semua unit menunggu review: tiap unit disetujui, jadwal pengingat per unit dipakai', async () => {
    const { svc, perUnitCalls } = approveSetup([waiting('j1', { type: 'cuci' }), waiting('j2', { type: 'cuci' })]);
    await svc.approveComplete('j1', 'admin', {
      allInOrder: true,
      units: [
        { jobId: 'j1', reminderEnabled: true, serviceIntervalDays: 90 },
        { jobId: 'j2', reminderEnabled: false },
      ],
    });
    expect(perUnitCalls().map((c: any) => [c[0], c[2]])).toEqual([
      ['j1', { reminderEnabled: true, serviceIntervalDays: 90 }],
      ['j2', { reminderEnabled: false, serviceIntervalDays: undefined }],
    ]);
  });

  it('siklus satu unit kosong (job cuci): ditolak SEBELUM ada unit yang disetujui', async () => {
    const { svc, perUnitCalls } = approveSetup([waiting('j1', { type: 'cuci' }), waiting('j2', { type: 'cuci' })]);
    await expect(
      svc.approveComplete('j1', 'admin', { allInOrder: true, units: [{ jobId: 'j1', serviceIntervalDays: 90 }] }),
    ).rejects.toThrow(/Unit Panasonic \(Ruang j2\): Siklus servis berikutnya wajib diisi/);
    expect(perUnitCalls()).toHaveLength(0);
  });

  it('perbaikan (tanpa jadwal pengingat): cukup allInOrder', async () => {
    const { svc, perUnitCalls } = approveSetup([waiting('j1'), waiting('j2')]);
    await svc.approveComplete('j2', 'admin', { allInOrder: true });
    expect(perUnitCalls().map((c: any) => c[0])).toEqual(['j1', 'j2']);
  });

  it('satu unit belum dihargai: ditolak SEBELUM ada unit yang disetujui, pesan menyebut unitnya', async () => {
    const { svc, perUnitCalls } = approveSetup([waiting('j1'), waiting('j2', { billingDerived: false })]);
    await expect(svc.approveComplete('j1', 'admin', { allInOrder: true })).rejects.toThrow(
      /Unit Panasonic \(Ruang j2\): Harga jasa untuk unit ini belum ditetapkan/,
    );
    expect(perUnitCalls()).toHaveLength(0);
  });

  it('masih ada unit yang belum diajukan selesai: ditolak', async () => {
    const { svc } = approveSetup([waiting('j1'), baseJob('j2')]);
    await expect(svc.approveComplete('j1', 'admin', { allInOrder: true })).rejects.toThrow(
      /belum diajukan selesai: Panasonic \(Ruang j2\)/,
    );
  });

  it('tidak ada yang menunggu review: ditolak; unit yang sudah selesai dilewati', async () => {
    const none = approveSetup([baseJob('j1', { status: 'selesai' })]);
    await expect(none.svc.approveComplete('j1', 'admin', { allInOrder: true })).rejects.toThrow(
      /Tidak ada unit yang menunggu review/,
    );
    const some = approveSetup([baseJob('j1', { status: 'selesai' }), waiting('j2')]);
    await some.svc.approveComplete('j2', 'admin', { allInOrder: true });
    expect(some.perUnitCalls().map((c: any) => c[0])).toEqual(['j2']);
  });

  it('bukan admin ditolak', async () => {
    const { svc } = approveSetup([waiting('j1')]);
    await expect(svc.approveComplete('j1', 'kasir', { allInOrder: true })).rejects.toThrow(/Hanya Admin/);
  });
});

describe('TechnicianJobsService.sendBack — allInOrder', () => {
  it('semua unit yang menunggu review dikembalikan bersama dengan catatan yang sama', async () => {
    const { svc, prisma } = orderSetup([
      baseJob('j1', { status: 'menunggu_review' }),
      baseJob('j2', { status: 'menunggu_review' }),
    ]);
    await svc.sendBack('j1', ' Foto unit 2 buram ', 'admin', { allInOrder: true });
    expect(prisma.technicianJob.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', status: 'menunggu_review' },
      data: expect.objectContaining({ status: 'sedang_dikerjakan', reviewNote: 'Foto unit 2 buram' }),
    });
  });

  it('tidak ada yang menunggu review: ditolak; catatan kosong dan non-admin tetap ditolak', async () => {
    const { svc, prisma } = orderSetup([baseJob('j1')]);
    prisma.technicianJob.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.sendBack('j1', 'x', 'admin', { allInOrder: true })).rejects.toThrow(/Tidak ada unit yang menunggu review/);
    await expect(svc.sendBack('j1', '  ', 'admin', { allInOrder: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.sendBack('j1', 'x', 'kasir', { allInOrder: true })).rejects.toThrow(/Hanya Admin/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Pengajuan sparepart satu untuk seluruh job: kalau unit pemegangnya dibatalkan, pengajuan pindah ke unit aktif lain.
// ---------------------------------------------------------------------------------------------------------------

describe('TechnicianJobsService.cancel — pengajuan sparepart seluruh job', () => {
  function cancelSetup(
    over: {
      type?: string;
      successor?: { id: string; billingDerived: boolean } | null;
      billingDerived?: boolean;
      pricingLines?: number; // baris jasa yang dipegang job yang dibatalkan
      successorLines?: number; // baris jasa milik pengganti (data lama per unit)
    } = {},
  ) {
    const job = {
      id: 'j1',
      orderId: 'o1',
      unitId: 'u1',
      type: over.type ?? 'perbaikan',
      status: 'sedang_dikerjakan',
      billingDerived: over.billingDerived ?? true,
      transportLevel: over.pricingLines ? 2 : 0,
      transportMode: 'dibagi',
    };
    const tx: any = {
      technicianJobAssignee: ownerAssignee,
      technicianJob: {
        update: jest.fn(async ({ data }: any) => ({ ...job, ...data })),
        findFirst: jest.fn(async () => (over.successor === undefined ? { id: 'j2', billingDerived: true } : over.successor)),
        count: jest.fn(async () => 1), // unit masih punya job lain terbuka -> status unit tidak disentuh
      },
      serviceOrderUnit: { updateMany: jest.fn(async () => ({ count: 1 })) },
      memberAcUnit: { updateMany: jest.fn(async () => ({ count: 0 })) },
      jobServiceLine: {
        count: jest.fn(async ({ where }: any) => (where.jobId === 'j1' ? (over.pricingLines ?? 0) : (over.successorLines ?? 0))),
        updateMany: jest.fn(async () => ({ count: over.pricingLines ?? 0 })),
      },
      materialRequest: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => []),
        update: jest.fn(),
      },
    };
    const prisma: any = {
      technicianJobAssignee: ownerAssignee,
      technicianJob: { findUnique: jest.fn(async () => job) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const jobBilling: any = { rebuild: jest.fn(async () => null) };
    const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, jobBilling, {} as any);
    return { svc, tx, jobBilling };
  }

  it('dengan flag: pengajuan pindah ke unit aktif berikutnya dan tagihannya dihitung ulang di kedua job', async () => {
    const { svc, tx, jobBilling } = cancelSetup();
    await svc.cancel('j1', 'a1', 'admin', { moveRequestsToSibling: true });
    expect(tx.technicianJob.findFirst).toHaveBeenCalledWith({
      where: { orderId: 'o1', id: { not: 'j1' }, status: { notIn: ['dibatalkan', 'selesai'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, billingDerived: true },
    });
    expect(tx.materialRequest.updateMany).toHaveBeenCalledWith({ where: { jobId: 'j1' }, data: { jobId: 'j2' } });
    expect(jobBilling.rebuild.mock.calls.map((c: any) => c[1])).toEqual(['j1', 'j2']);
  });

  it('unit pengganti belum dihargai: pengajuan tetap dipindah, tagihannya menyusul saat dihargai (tanpa rebuild)', async () => {
    const { svc, tx, jobBilling } = cancelSetup({ successor: { id: 'j2', billingDerived: false } });
    await svc.cancel('j1', 'a1', 'admin', { moveRequestsToSibling: true });
    expect(tx.materialRequest.updateMany).toHaveBeenCalledWith({ where: { jobId: 'j1' }, data: { jobId: 'j2' } });
    expect(jobBilling.rebuild.mock.calls.map((c: any) => c[1])).toEqual(['j1']);
  });

  it('tanpa flag (app mobile / satu unit): tidak ada pemindahan, perilaku lama', async () => {
    const { svc, tx } = cancelSetup();
    await svc.cancel('j1', 'a1', 'admin');
    expect(tx.technicianJob.findFirst).not.toHaveBeenCalled();
    expect(tx.materialRequest.updateMany).toHaveBeenCalledTimes(1); // hanya penolakan otomatis yang pending
    expect(tx.materialRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'rejected' });
  });

  it('unit pemegang harga jasa dibatalkan: baris jasa + transport pindah ke unit aktif berikutnya (walau tanpa flag), tagihan dihitung ulang', async () => {
    const { svc, tx, jobBilling } = cancelSetup({ pricingLines: 2, successor: { id: 'j2', billingDerived: false } });
    await svc.cancel('j1', 'a1', 'admin'); // tanpa flag (mis. dari app mobile)
    expect(tx.jobServiceLine.updateMany).toHaveBeenCalledWith({ where: { jobId: 'j1' }, data: { jobId: 'j2' } });
    expect(tx.technicianJob.update).toHaveBeenCalledWith({
      where: { id: 'j2' },
      data: { billingDerived: true, transportLevel: 2, transportMode: 'dibagi' },
    });
    expect(tx.technicianJob.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { transportLevel: 0 } });
    expect(tx.materialRequest.updateMany).toHaveBeenCalledTimes(1); // pengajuan TIDAK dipindah tanpa flag (hanya tolak pending)
    expect(jobBilling.rebuild.mock.calls.map((c: any) => c[1])).toEqual(['j1', 'j2']);
  });

  it('pengganti sudah punya baris jasa sendiri (data lama per unit): baris tidak dipindah supaya tidak dobel', async () => {
    const { svc, tx } = cancelSetup({ pricingLines: 2, successorLines: 1, successor: { id: 'j2', billingDerived: true } });
    await svc.cancel('j1', 'a1', 'admin');
    expect(tx.jobServiceLine.updateMany).not.toHaveBeenCalled();
  });

  it('unit terakhir yang aktif: tidak ada pengganti, pengajuan ikut dibatalkan seperti biasa', async () => {
    const { svc, tx } = cancelSetup({ successor: null });
    await svc.cancel('j1', 'a1', 'admin', { moveRequestsToSibling: true });
    expect(tx.materialRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'rejected' });
  });

  it('pemasangan (POS) tidak pernah digabung walau flag dikirim', async () => {
    const { svc, tx } = cancelSetup({ type: 'pemasangan' });
    await svc.cancel('j1', 'a1', 'admin', { moveRequestsToSibling: true });
    expect(tx.technicianJob.findFirst).not.toHaveBeenCalled();
  });
});

describe('TechnicianJobsService.start — job yang dialihkan harus di-scan ulang teknisi baru', () => {
  function startSetup(job: Record<string, unknown>) {
    const full = {
      id: 'j1',
      orderId: 'o1',
      unitId: 'u1',
      type: 'perbaikan',
      status: 'assigned',
      technicianId: 't2',
      startedAt: null,
      unit: { barcodeValue: 'BC-1', status: 'dalam_maintenance' },
      ...job,
    };
    const tx: any = {
      technicianJobAssignee: { count: jest.fn(async () => 1) }, // t2 = teknisi baru, assignee job ini
      technicianJob: { update: jest.fn(async ({ data }: any) => ({ ...full, ...data })) },
      serviceOrderUnit: { updateMany: jest.fn(async () => ({ count: 1 })) },
      memberAcUnit: { update: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      technicianJobAssignee: { count: jest.fn(async () => 1) }, // t2 = teknisi baru, assignee job ini
      technicianJob: { findUnique: jest.fn(async () => full) },
      jobFindingPhoto: { count: jest.fn(async () => 1) }, // foto sebelum dari teknisi sebelumnya
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { svc: new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any), tx };
  }

  it('barcode salah ditolak; barcode benar memulai lagi dan waktu mulai pertama dipertahankan', async () => {
    const first = new Date('2026-11-03T08:00:00.000Z');
    const { svc, tx } = startSetup({ startedAt: first });
    await expect(svc.start('j1', 'BC-SALAH', 't2', 'teknisi')).rejects.toThrow(/Barcode tidak sesuai/);
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
    const res: any = await svc.start('j1', 'BC-1', 't2', 'teknisi');
    expect(res.status).toBe('sedang_dikerjakan');
    expect(res.startedAt).toBe(first);
  });

  it('job yang belum pernah dimulai: startedAt diisi sekarang', async () => {
    const { svc } = startSetup({});
    const res: any = await svc.start('j1', 'BC-1', 't2', 'teknisi');
    expect(res.startedAt).toBeInstanceOf(Date);
  });
});
