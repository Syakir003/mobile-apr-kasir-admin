import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';

// Guard akses job kini berbasis tabel assignees (semua teknisi job setara); di tes ini pemilik job = 't1'.
const ownerAssignee = {
  count: jest.fn(async ({ where }: any) => (where.technicianId === 't1' ? 1 : 0)),
};


// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Keterangan teknisi = catatan SATU ORDER untuk admin (service_orders.technician_note). BEDA dari Diagnosa / Catatan
// Pengerjaan (technician_jobs.notes, per unit): keduanya tidak boleh saling menimpa.
function setup(job: Record<string, unknown> | null = {}) {
  const prisma: any = {
    technicianJobAssignee: ownerAssignee,
    technicianJob: {
      findUnique: jest.fn(async () => (job === null ? null : { id: 'j1', orderId: 'o1', technicianId: 't1', status: 'sedang_dikerjakan', ...job })),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    serviceOrder: { update: jest.fn(async () => ({})) },
  };
  const svc = new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, prisma };
}

describe('TechnicianJobsService.updateKeterangan', () => {
  it('menyimpan ke ORDER (technician_note), tidak menyentuh catatan diagnosa job', async () => {
    const { svc, prisma } = setup();
    const r = await svc.updateKeterangan('j1', '  Cuci 2 Unit AC dibayar cash 75 ribu  ', 't1', 'teknisi');
    expect(prisma.serviceOrder.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { technicianNote: 'Cuci 2 Unit AC dibayar cash 75 ribu' },
    });
    expect(prisma.technicianJob.update).not.toHaveBeenCalled();
    expect(prisma.technicianJob.updateMany).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, orderId: 'o1', technicianNote: 'Cuci 2 Unit AC dibayar cash 75 ribu' });
  });

  it('kosong/spasi menghapus Keterangan (null)', async () => {
    const { svc, prisma } = setup();
    await svc.updateKeterangan('j1', '   ', 't1', 'teknisi');
    expect(prisma.serviceOrder.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { technicianNote: null } });
  });

  it('hanya selama job aktif (ditugaskan / sedang dikerjakan)', async () => {
    for (const status of ['menunggu_review', 'selesai', 'dibatalkan', 'menunggu_penugasan']) {
      const { svc, prisma } = setup({ status });
      await expect(svc.updateKeterangan('j1', 'x', 't1', 'teknisi')).rejects.toThrow(BadRequestException);
      expect(prisma.serviceOrder.update).not.toHaveBeenCalled();
    }
    const { svc } = setup({ status: 'assigned' });
    await expect(svc.updateKeterangan('j1', 'x', 't1', 'teknisi')).resolves.toMatchObject({ ok: true });
  });

  it('teknisi lain ditolak; admin boleh; job tidak ada = 404', async () => {
    const { svc, prisma } = setup();
    await expect(svc.updateKeterangan('j1', 'x', 't-lain', 'teknisi')).rejects.toThrow(ForbiddenException);
    expect(prisma.serviceOrder.update).not.toHaveBeenCalled();
    await expect(svc.updateKeterangan('j1', 'x', 'admin1', 'admin')).resolves.toMatchObject({ ok: true });
    const none = setup(null);
    await expect(none.svc.updateKeterangan('j1', 'x', 't1', 'teknisi')).rejects.toThrow(NotFoundException);
  });
});

describe('TechnicianJobsService.updateNotes (Diagnosa per unit) tetap per job', () => {
  it('hanya mengubah job itu sendiri, tidak menyentuh order maupun job lain', async () => {
    const { svc, prisma } = setup();
    await svc.updateNotes('j1', 'Tekanan freon normal', 't1', 'teknisi');
    expect(prisma.technicianJob.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { notes: 'Tekanan freon normal' } });
    expect(prisma.technicianJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.serviceOrder.update).not.toHaveBeenCalled();
  });
});
