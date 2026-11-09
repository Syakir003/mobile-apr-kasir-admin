import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// Penugasan beberapa teknisi per job (semua setara). Satu-satunya tempat yang tahu cara membaca/menulis daftar teknisi
// sebuah job; technician_jobs.technician_id selalu = teknisi pertama supaya kode & APK lama tetap jalan.

export const MAX_ASSIGNEES = 5;

/** `technicianIds` menang; kalau tidak ada pakai `technicianId` lama. Kosong/duplikat dibuang, urutan dipertahankan. */
export function normalizeTechnicianIds(src: { technicianIds?: string[]; technicianId?: string | null }): string[] {
  const raw = src.technicianIds ?? (src.technicianId ? [src.technicianId] : []);
  return [...new Set(raw.map((id) => id.trim()).filter(Boolean))];
}

/** Semua id harus user role teknisi yang aktif; maksimal 5. Dipanggil SEBELUM menulis apa pun. */
export async function assertValidTechnicians(
  db: { user: { findMany: (args: any) => Promise<{ id: string; role: string; active: boolean }[]> } },
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  if (ids.length > MAX_ASSIGNEES) throw new BadRequestException(`Maksimal ${MAX_ASSIGNEES} teknisi per job`);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true, active: true } });
  const valid = new Set(users.filter((u) => u.role === 'teknisi' && u.active).map((u) => u.id));
  if (ids.some((id) => !valid.has(id))) throw new BadRequestException('Teknisi tidak valid atau tidak aktif');
}

/** Ganti seluruh teknisi job dan jaga technician_id = teknisi pertama (null bila kosong). */
export async function setJobAssignees(tx: Prisma.TransactionClient, jobId: string, ids: string[]): Promise<void> {
  await tx.technicianJobAssignee.deleteMany({ where: { jobId } });
  if (ids.length > 0) {
    await tx.technicianJobAssignee.createMany({ data: ids.map((technicianId) => ({ jobId, technicianId })) });
  }
  await tx.technicianJob.update({ where: { id: jobId }, data: { technicianId: ids[0] ?? null } });
}

export async function isJobAssignee(
  db: { technicianJobAssignee: { count: (args: any) => Promise<number> } },
  jobId: string,
  userId: string,
): Promise<boolean> {
  return (await db.technicianJobAssignee.count({ where: { jobId, technicianId: userId } })) > 0;
}

/** Filter `where` untuk query job milik/ditugaskan ke teknisi ini. */
export const assignedTo = (userId: string): Prisma.TechnicianJobWhereInput => ({
  assignees: { some: { technicianId: userId } },
});
