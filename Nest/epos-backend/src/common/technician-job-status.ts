// technician_jobs.status di Supabase bertipe TEXT (bukan enum Postgres) —
// nilai yang valid dijaga RPC update_technician_job_status. Konstanta ini
// menggantikan enum Prisma `TechnicianJobStatus` dari skema Nest lama.
export const TechnicianJobStatus = {
  menunggu_penugasan: 'menunggu_penugasan',
  assigned: 'assigned',
  sedang_dikerjakan: 'sedang_dikerjakan',
  menunggu_review: 'menunggu_review',
  selesai: 'selesai',
  dibatalkan: 'dibatalkan',
} as const;

export type TechnicianJobStatus = (typeof TechnicianJobStatus)[keyof typeof TechnicianJobStatus];
