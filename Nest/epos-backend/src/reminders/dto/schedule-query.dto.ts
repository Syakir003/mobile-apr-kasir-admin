import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SCHEDULE_STATUSES } from '../service-schedule.util';

/** Query `GET /reminders/schedule` — monitoring jadwal servis. */
export class ScheduleQueryDto {
  @IsOptional() @IsIn(SCHEDULE_STATUSES as unknown as string[]) status?: (typeof SCHEDULE_STATUSES)[number];
  @IsOptional() @IsString() q?: string;
  // Batasi ke set AC milik satu pelanggan (halaman jadwal per pelanggan). Diabaikan oleh GET schedule/members.
  @IsOptional() @IsString() memberId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
