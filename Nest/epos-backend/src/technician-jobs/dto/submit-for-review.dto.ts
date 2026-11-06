import { IsBoolean, IsOptional } from 'class-validator';

/** Body opsional `PATCH /technician-jobs/:id/submit-for-review`. */
export class SubmitForReviewDto {
  /** Servis banyak AC: ajukan selesai SELURUH job (semua unit di order ini) sekaligus, bukan satu unit. */
  @IsOptional() @IsBoolean() allInOrder?: boolean;
}
