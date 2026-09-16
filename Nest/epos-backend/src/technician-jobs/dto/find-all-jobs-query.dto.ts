import { IsEnum, IsOptional } from 'class-validator';
import { TechnicianJobStatus } from '@prisma/client';

// Query param `status` di GET /technician-jobs (admin/kasir) — sejak `status`
// jadi enum Postgres beneran (bukan String polos lagi), nilai sembarangan di
// sini WAJIB divalidasi DI SINI (400 Bad Request yang jelas) daripada
// dibiarkan nembus ke Prisma dan bikin Postgres nolak dengan error mentah
// "invalid input value for enum" (500 gak jelas).
export class FindAllJobsQueryDto {
  @IsOptional()
  @IsEnum(TechnicianJobStatus)
  status?: TechnicianJobStatus;
}
