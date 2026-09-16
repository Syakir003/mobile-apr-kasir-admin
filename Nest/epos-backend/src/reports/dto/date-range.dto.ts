import { IsISO8601 } from 'class-validator';

export class DateRangeDto {
  @IsISO8601() from: string; // contoh: "2026-08-01"
  @IsISO8601() to: string; // contoh: "2026-08-20"
}
