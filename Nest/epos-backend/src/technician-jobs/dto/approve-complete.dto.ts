import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

/** Jadwal pengingat satu unit pada persetujuan seluruh order servis banyak AC (`units[]`). */
export class ApproveUnitScheduleDto {
  @IsString() @IsNotEmpty() jobId: string;
  @IsOptional() @IsBoolean() reminderEnabled?: boolean;
  @IsOptional() @IsInt({ message: 'Siklus servis harus bilangan bulat (hari)' }) @Min(7, { message: 'Siklus servis minimal 7 hari' }) @Max(730, { message: 'Siklus servis maksimal 730 hari' })
  serviceIntervalDays?: number;
}

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

  /** Servis banyak AC: setujui SEMUA unit (job) order ini yang menunggu review sekaligus. */
  @IsOptional() @IsBoolean() allInOrder?: boolean;
  /** Dengan allInOrder: jadwal pengingat per unit. Unit yang tidak disebut memakai nilai di atas. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ApproveUnitScheduleDto)
  units?: ApproveUnitScheduleDto[];
}
