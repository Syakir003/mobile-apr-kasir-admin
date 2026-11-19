import { BadRequestException } from '@nestjs/common';
import { TechnicianJobsService } from './technician-jobs.service';

// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

// Gate foto: foto SEBELUM boleh sejak job Ditugaskan (Mulai Job justru mewajibkannya lebih dulu), foto SESUDAH baru boleh
// setelah Mulai Job (job Sedang Dikerjakan). Job yang dialihkan kembali ke Ditugaskan menahan foto sesudah baru lagi.

const ownerAssignee = { count: jest.fn(async ({ where }: any) => (where.technicianId === 't1' ? 1 : 0)) };

function setup(status: string) {
  const job = { id: 'j1', orderId: 'o1', unitId: 'u1', status, technicianId: 't1' };
  const prisma: any = {
    technicianJobAssignee: ownerAssignee,
    technicianJob: { findUnique: jest.fn(async () => job) },
    jobFinding: { findUnique: jest.fn(async () => ({ id: 'f1', jobId: 'j1' })) },
    jobFindingPhoto: { create: jest.fn(async ({ data }: any) => ({ id: 'p1', ...data })) },
  };
  return { svc: new TechnicianJobsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any), prisma };
}

describe('TechnicianJobsService.addFindingPhoto — gate foto sesudah', () => {
  it('foto SEBELUM boleh saat job masih Ditugaskan (belum scan/Mulai Job)', async () => {
    const { svc, prisma } = setup('assigned');
    await svc.addFindingPhoto('j1', 'f1', 'sebelum', '/uploads/a.jpg', 't1', 'teknisi');
    expect(prisma.jobFindingPhoto.create).toHaveBeenCalledWith({
      data: { findingId: 'f1', kind: 'sebelum', path: '/uploads/a.jpg', uploadedById: 't1' },
    });
  });

  it('foto SESUDAH ditolak saat job masih Ditugaskan, pesan menyuruh scan & Mulai Job', async () => {
    const { svc, prisma } = setup('assigned');
    await expect(svc.addFindingPhoto('j1', 'f1', 'sesudah', '/uploads/a.jpg', 't1', 'teknisi')).rejects.toThrow(
      /setelah Mulai Job/,
    );
    await expect(svc.addFindingPhoto('j1', 'f1', 'sesudah', '/uploads/a.jpg', 't1', 'teknisi')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.jobFindingPhoto.create).not.toHaveBeenCalled();
  });

  it('foto SESUDAH berlaku sama untuk admin (tidak ada jalan pintas lewat peran)', async () => {
    const { svc, prisma } = setup('assigned');
    await expect(svc.addFindingPhoto('j1', 'f1', 'sesudah', '/uploads/a.jpg', 'admin1', 'admin')).rejects.toThrow(
      /setelah Mulai Job/,
    );
    expect(prisma.jobFindingPhoto.create).not.toHaveBeenCalled();
  });

  it('foto SESUDAH boleh setelah Mulai Job (Sedang Dikerjakan)', async () => {
    const { svc, prisma } = setup('sedang_dikerjakan');
    await svc.addFindingPhoto('j1', 'f1', 'sesudah', '/uploads/b.jpg', 't1', 'teknisi');
    expect(prisma.jobFindingPhoto.create).toHaveBeenCalledWith({
      data: { findingId: 'f1', kind: 'sesudah', path: '/uploads/b.jpg', uploadedById: 't1' },
    });
  });

  it('job yang sudah menunggu review/selesai tetap menolak foto apa pun', async () => {
    const { svc } = setup('menunggu_review');
    await expect(svc.addFindingPhoto('j1', 'f1', 'sebelum', '/uploads/a.jpg', 't1', 'teknisi')).rejects.toThrow(
      /saat job aktif/,
    );
  });
});
