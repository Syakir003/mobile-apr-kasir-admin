import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TechnicianJobStatus } from '../../common/technician-job-status';

// Query param `status` di GET /technician-jobs (admin/kasir) — sejak `status`
// jadi enum Postgres beneran (bukan String polos lagi), nilai sembarangan di
// sini WAJIB divalidasi DI SINI (400 Bad Request yang jelas) daripada
// dibiarkan nembus ke Prisma dan bikin Postgres nolak dengan error mentah
// "invalid input value for enum" (500 gak jelas).
export class FindAllJobsQueryDto {
  @IsOptional()
  @IsEnum(TechnicianJobStatus)
  status?: TechnicianJobStatus;

  // Riwayat servis per unit AC (dipakai mobile) — teknisi cuma boleh isi ini
  // kalau punya job sendiri di unit tsb, lihat TechnicianJobsService.findAll,
  // port dari RLS `my_visible_job_ids()` (migrasi 0020).
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
