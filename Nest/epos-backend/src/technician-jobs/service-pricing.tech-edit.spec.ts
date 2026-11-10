import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ServicePricingService } from './service-pricing.service';

// Teknisi (assignee) boleh MELIHAT harga jasa job-nya; penyesuaian ada di blok describe berikutnya (Task 3).

describe('ServicePricingService.getFor — akses baca harga', () => {
  function make(isAssignee: boolean) {
    const prisma: any = { technicianJobAssignee: { count: jest.fn(async () => (isAssignee ? 1 : 0)) } };
    const svc = new ServicePricingService(prisma, {} as any, {} as any);
    const get = jest.spyOn(svc, 'get').mockResolvedValue({ jobId: 'j1' } as any);
    return { svc, prisma, get };
  }

  it('teknisi yang bukan assignee ditolak dan data tidak dibaca', async () => {
    const { svc, get } = make(false);
    await expect(svc.getFor('j1', 't9', 'teknisi')).rejects.toThrow(ForbiddenException);
    expect(get).not.toHaveBeenCalled();
  });

  it('teknisi assignee boleh membaca', async () => {
    const { svc, prisma, get } = make(true);
    await expect(svc.getFor('j1', 't1', 'teknisi')).resolves.toEqual({ jobId: 'j1' });
    expect(prisma.technicianJobAssignee.count).toHaveBeenCalledWith({ where: { jobId: 'j1', technicianId: 't1' } });
    expect(get).toHaveBeenCalledWith('j1');
  });

  it('admin/kasir tidak perlu menjadi assignee', async () => {
    const { svc, prisma, get } = make(false);
    await svc.getFor('j1', 'a1', 'admin');
    await svc.getFor('j1', 'k1', 'kasir');
    expect(prisma.technicianJobAssignee.count).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('ServicePricingService.get — field penyesuaian teknisi', () => {
  function make(over: Record<string, unknown> = {}) {
    const job = {
      id: 'j1', orderId: 'o1', type: 'cuci', status: 'sedang_dikerjakan', findingsSentAt: null, billingDerived: true,
      transportLevel: 0, transportMode: 'individu',
      techPriceEditedAt: null, techPriceEditReason: null, priceBeforeTechEdit: null,
      serviceLines: [
        { id: 'l1', serviceId: 's1', name: 'Cuci AC', qty: 3, unitPrice: 75000, source: 'teknisi', isCustom: false, changeReason: 'Unit ketiga ikut dicuci' },
      ],
      order: { invoiceId: 'inv1', invoice: { id: 'inv1', number: 'INV-1', status: 'belum_dibayar', grandTotal: 225000, totalPaid: 0 } },
      ...over,
    };
    const prisma: any = {
      technicianJob: {
        findUnique: jest.fn(async () => job),
        findFirst: jest.fn(async () => ({ id: 'j1' })),
        findMany: jest.fn(async () => [{ id: 'j1' }]),
      },
      materialRequest: { findMany: jest.fn(async () => []) },
      invoiceItem: { findMany: jest.fn(async () => []) },
    };
    return { svc: new ServicePricingService(prisma, {} as any, {} as any), job };
  }

  it('baris membawa source/isCustom/changeReason dan ada blok techEdit', async () => {
    const at = new Date('2026-11-11T03:00:00Z');
    const { svc } = make({ techPriceEditedAt: at, techPriceEditReason: 'Unit ketiga ikut dicuci', priceBeforeTechEdit: 150000 });
    const r = await svc.get('j1');
    expect(r.lines[0]).toMatchObject({ id: 'l1', source: 'teknisi', isCustom: false, changeReason: 'Unit ketiga ikut dicuci' });
    expect(r.techEdit).toEqual({ at, reason: 'Unit ketiga ikut dicuci', subtotalBefore: 150000, subtotalAfter: 225000 });
  });

  it('techEdit null bila jasa belum pernah disesuaikan teknisi', async () => {
    const { svc } = make();
    const r = await svc.get('j1');
    expect(r.techEdit).toBeNull();
  });
});

type Line = {
  id: string; jobId: string; serviceId: string | null; name: string; qty: number; unitPrice: number;
  position: number; source: string; isCustom: boolean;
};

const cuci: Line = { id: 'l1', jobId: 'j1', serviceId: 's-cuci', name: 'Cuci AC', qty: 2, unitPrice: 75000, position: 0, source: 'admin', isCustom: false };
const bongkar: Line = { id: 'l2', jobId: 'j1', serviceId: null, name: 'Bongkar pasang', qty: 1, unitPrice: 50000, position: 1, source: 'admin', isCustom: false };

function setupEdit(over: {
  status?: string; type?: string; complaintOfJobId?: string | null; assignee?: boolean; billingDerived?: boolean;
  invoiceId?: string | null; lines?: Line[]; editedAt?: Date | null; ownerStatus?: string; fieldPayments?: number;
} = {}) {
  const lines = over.lines ?? [cuci];
  const owner = {
    id: 'j1', orderId: 'o1', memberId: 'm1', type: over.type ?? 'cuci', status: over.ownerStatus ?? over.status ?? 'sedang_dikerjakan',
    complaintOfJobId: over.complaintOfJobId ?? null, billingDerived: over.billingDerived ?? true,
    techPriceEditedAt: over.editedAt ?? null, serviceLines: lines,
  };
  const services: Record<string, any> = {
    's-cuci': { id: 's-cuci', name: 'Cuci AC', basePrice: 75000, active: true },
    's-freon': { id: 's-freon', name: 'Isi Freon', basePrice: 200000, active: true },
    's-off': { id: 's-off', name: 'Jasa lama', basePrice: 1000, active: false },
  };
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    technicianJobAssignee: { count: jest.fn(async () => (over.assignee === false ? 0 : 1)) },
    technicianJob: {
      // Bacaan awal (select) memakai status job yang diminta; bacaan pemegang harga (include) memakai ownerStatus.
      findUnique: jest.fn(async ({ where, include }: any) =>
        where.id === 'j1' ? { ...owner, status: include ? owner.status : (over.status ?? 'sedang_dikerjakan') } : null),
      findFirst: jest.fn(async () => ({ id: 'j1' })),
      update: jest.fn(async () => ({})),
    },
    serviceOrder: { findUnique: jest.fn(async () => ({ id: 'o1', invoiceId: over.invoiceId === undefined ? 'inv1' : over.invoiceId })) },
    fieldPayment: { count: jest.fn(async () => over.fieldPayments ?? 0) },
    jobServiceLine: { delete: jest.fn(async () => ({})), update: jest.fn(async () => ({})), create: jest.fn(async () => ({})) },
    service: { findUnique: jest.fn(async ({ where }: any) => services[where.id] ?? null) },
    user: { findUnique: jest.fn(async () => ({ displayName: 'Budi' })) },
    member: { findUnique: jest.fn(async () => ({ name: 'Bu Sari' })) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const billing: any = { rebuild: jest.fn(async () => ({ newTotal: 350000 })) };
  const svc = new ServicePricingService(prisma, {} as any, billing);
  return { svc, tx, billing };
}

const alasan = 'Unit ketiga ikut dicuci';

describe('ServicePricingService.techEditLines — penyesuaian jasa oleh teknisi', () => {
  it('menaikkan jumlah baris admin: harga tetap, baris ditandai teknisi + alasan, tagihan dihitung ulang, admin ditandai', async () => {
    const { svc, tx, billing } = setupEdit();
    const r = await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 't1');
    expect(tx.jobServiceLine.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { qty: 3, position: 0, source: 'teknisi', changeReason: alasan },
    });
    expect(billing.rebuild).toHaveBeenCalledWith(tx, 'j1', 't1');
    const mark = tx.technicianJob.update.mock.calls[0][0];
    expect(mark.where).toEqual({ id: 'j1' });
    expect(mark.data).toMatchObject({ techPriceEditReason: alasan, priceBeforeTechEdit: 150000 });
    expect(mark.data.techPriceEditedAt).toBeInstanceOf(Date);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorUid: 't1', action: 'job.tech_edit_lines', target: 'j1' });
    expect(r).toMatchObject({ ok: true, jobId: 'j1', reason: alasan, subtotalBefore: 150000, subtotalAfter: 225000, actorName: 'Budi', customerName: 'Bu Sari' });
  });

  it('baris yang jumlahnya tidak berubah dipertahankan apa adanya (source tetap admin, tanpa alasan)', async () => {
    const { svc, tx } = setupEdit({ lines: [cuci, bongkar] });
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 3 }, { id: 'l2', qty: 1 }], reason: alasan }, 't1');
    expect(tx.jobServiceLine.update).toHaveBeenCalledWith({ where: { id: 'l2' }, data: { qty: 1, position: 1, source: 'admin' } });
  });

  it('tambah dari katalog: harga = harga katalog, ditandai teknisi', async () => {
    const { svc, tx } = setupEdit();
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 2 }, { serviceId: 's-freon', qty: 1 }], reason: 'Freon kurang' }, 't1');
    expect(tx.jobServiceLine.create).toHaveBeenCalledWith({
      data: { jobId: 'j1', serviceId: 's-freon', name: 'Isi Freon', qty: 1, unitPrice: 200000, position: 1, source: 'teknisi', isCustom: false, changeReason: 'Freon kurang' },
    });
  });

  it('jasa lain: nama + harga dari teknisi, ditandai isCustom', async () => {
    const { svc, tx } = setupEdit();
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 2 }, { name: ' Ganti kapasitor ', qty: 1, unitPrice: 120000 }], reason: 'Kapasitor rusak' }, 't1');
    expect(tx.jobServiceLine.create).toHaveBeenCalledWith({
      data: { jobId: 'j1', serviceId: null, name: 'Ganti kapasitor', qty: 1, unitPrice: 120000, position: 1, source: 'teknisi', isCustom: true, changeReason: 'Kapasitor rusak' },
    });
  });

  it('menghapus baris yang tidak ikut dikirim', async () => {
    const { svc, tx } = setupEdit({ lines: [cuci, bongkar] });
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 2 }, { name: 'Lain', qty: 1, unitPrice: 10000 }], reason: 'Bongkar pasang tidak jadi' }, 't1');
    expect(tx.jobServiceLine.delete).toHaveBeenCalledWith({ where: { id: 'l2' } });
  });

  it('penyesuaian kedua tidak menimpa subtotal awal admin (priceBeforeTechEdit)', async () => {
    const { svc, tx } = setupEdit({ editedAt: new Date('2026-11-11T01:00:00Z') });
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 4 }], reason: alasan }, 't1');
    expect(tx.technicianJob.update.mock.calls[0][0].data).not.toHaveProperty('priceBeforeTechEdit');
  });

  const tolak: [string, () => ReturnType<typeof setupEdit>, any, string][] = [
    ['harga baris admin tidak bisa diubah', () => setupEdit(), { lines: [{ id: 'l1', qty: 2, unitPrice: 10000 }], reason: alasan }, 'Harga satuan'],
    ['harga katalog tidak bisa diakali', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { serviceId: 's-freon', qty: 1, unitPrice: 5000 }], reason: alasan }, 'harga katalog'],
    ['jasa katalog nonaktif', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { serviceId: 's-off', qty: 1 }], reason: alasan }, 'nonaktif'],
    ['jasa katalog tidak ada', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { serviceId: 'x', qty: 1 }], reason: alasan }, 'tidak ditemukan'],
    ['jasa lain tanpa nama', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { qty: 1, unitPrice: 1000 }], reason: alasan }, 'Nama jasa lain'],
    ['jasa lain tanpa harga', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { name: 'Lain', qty: 1 }], reason: alasan }, 'Harga jasa lain'],
    ['id baris tidak dikenal', () => setupEdit(), { lines: [{ id: 'zzz', qty: 1 }], reason: alasan }, 'Baris jasa tidak ditemukan'],
    ['baris yang sama dikirim dua kali', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }, { id: 'l1', qty: 3 }], reason: alasan }, 'dua kali'],
    ['tanpa perubahan', () => setupEdit(), { lines: [{ id: 'l1', qty: 2 }], reason: alasan }, 'Tidak ada perubahan'],
    ['alasan terlalu pendek', () => setupEdit(), { lines: [{ id: 'l1', qty: 3 }], reason: '  ab ' }, 'Alasan'],
    ['daftar kosong', () => setupEdit(), { lines: [], reason: alasan }, 'Minimal satu baris'],
    ['job belum dihargai admin', () => setupEdit({ billingDerived: false }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'belum ditetapkan admin'],
    ['order tanpa invoice', () => setupEdit({ invoiceId: null }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'belum ditetapkan admin'],
    ['job menunggu review', () => setupEdit({ status: 'menunggu_review' }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'Ditugaskan atau Sedang Dikerjakan'],
    ['pemegang harga sudah selesai', () => setupEdit({ ownerStatus: 'selesai' }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'setelah job selesai'],
    ['job komplain', () => setupEdit({ complaintOfJobId: 'j0' }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'komplain'],
    ['pemasangan', () => setupEdit({ type: 'pemasangan' }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'pemasangan'],
    ['pembayaran lapangan sudah tercatat (Tanda Terima beredar)', () => setupEdit({ fieldPayments: 1 }), { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 'Tanda Terima'],
  ];
  it.each(tolak)('ditolak 400: %s (tidak ada yang ditulis)', async (_nama, make, dto, pesan) => {
    const { svc, tx, billing } = make();
    await expect(svc.techEditLines('j1', dto, 't1')).rejects.toThrow(BadRequestException);
    await expect(svc.techEditLines('j1', dto, 't1')).rejects.toThrow(pesan);
    expect(tx.jobServiceLine.update).not.toHaveBeenCalled();
    expect(tx.jobServiceLine.create).not.toHaveBeenCalled();
    expect(tx.jobServiceLine.delete).not.toHaveBeenCalled();
    expect(billing.rebuild).not.toHaveBeenCalled();
  });

  it('kunci edit: pembayaran lapangan yang ditolak admin tidak mengunci; selain itu mengunci', async () => {
    const { svc, tx } = setupEdit();
    await svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 't1');
    expect(tx.fieldPayment.count).toHaveBeenCalledWith({ where: { orderId: 'o1', status: { not: 'ditolak' } } });
  });

  it('bukan assignee job: 403', async () => {
    const { svc, tx } = setupEdit({ assignee: false });
    await expect(svc.techEditLines('j1', { lines: [{ id: 'l1', qty: 3 }], reason: alasan }, 't9')).rejects.toThrow(ForbiddenException);
    expect(tx.jobServiceLine.update).not.toHaveBeenCalled();
  });
});

// Penyesuaian teknisi SUDAH berlaku sejak disimpan (tagihan dihitung ulang, teknisi bisa langsung menagih); penanda untuk
// admin hanya informasi. Admin boleh menandainya sudah ditinjau TANPA menyimpan ulang harga.
describe('ServicePricingService.acknowledgeTechEdit — tandai sudah ditinjau tanpa menyimpan harga', () => {
  function setupAck(edited: boolean) {
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      technicianJob: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'j1' ? { id: 'j1', orderId: 'o1', type: 'cuci', techPriceEditedAt: edited ? new Date() : null } : null,
        ),
        findFirst: jest.fn(async () => ({ id: 'j1' })),
        update: jest.fn(async () => ({})),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const billing: any = { rebuild: jest.fn() };
    return { svc: new ServicePricingService(prisma, {} as any, billing), tx, billing };
  }

  it('menghapus penanda di job pemegang harga, dengan audit; harga/tagihan tidak disentuh', async () => {
    const { svc, tx, billing } = setupAck(true);
    await expect(svc.acknowledgeTechEdit('j1', 'a1')).resolves.toEqual({ ok: true, jobId: 'j1', cleared: true });
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain('FROM service_orders');
    expect(tx.technicianJob.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { techPriceEditedAt: null, techPriceEditReason: null, priceBeforeTechEdit: null },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorUid: 'a1', action: 'job.tech_edit_ack', target: 'j1' });
    expect(billing.rebuild).not.toHaveBeenCalled();
  });

  it('tidak ada penanda: tidak melakukan apa pun (aman dipanggil ulang)', async () => {
    const { svc, tx } = setupAck(false);
    await expect(svc.acknowledgeTechEdit('j1', 'a1')).resolves.toEqual({ ok: true, jobId: 'j1', cleared: false });
    expect(tx.technicianJob.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('job tidak ada: 404', async () => {
    const { svc } = setupAck(true);
    await expect(svc.acknowledgeTechEdit('zzz', 'a1')).rejects.toThrow('Job tidak ditemukan');
  });
});
