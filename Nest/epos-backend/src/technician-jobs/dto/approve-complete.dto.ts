import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Body opsional `PATCH /technician-jobs/:id/approve-complete` (2026-09-30).
 * Hanya dipakai untuk job cuci/maintenance/pemasangan — jenis lain
 * mengabaikannya. Lihat resolveApproveSchedule. */
export class ApproveCompleteDto {
  /** false = matikan pengingat AC ini (mis. AC dibongkar). Default nyala. */
  @IsOptional() @IsBoolean() reminderEnabled?: boolean;
  /** Siklus servis berikutnya dalam hari; wajib kalau pengingat nyala
   * (kecuali unit sudah punya siklus tersimpan). */
  @IsOptional() @IsInt({ message: 'Siklus servis harus bilangan bulat (hari)' }) @Min(7, { message: 'Siklus servis minimal 7 hari' }) @Max(730, { message: 'Siklus servis maksimal 730 hari' })
  serviceIntervalDays?: number;
}
