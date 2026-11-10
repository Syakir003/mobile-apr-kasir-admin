import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body opsional `PATCH /technician-jobs/:id/submit-for-review`. */
export class SubmitForReviewDto {
  /** Servis banyak AC: ajukan selesai SELURUH job (semua unit di order ini) sekaligus, bukan satu unit. */
  @IsOptional() @IsBoolean() allInOrder?: boolean;

  /**
   * Order bayar_di_lokasi tanpa pembayaran tercatat: alasan teknisi (min. 5 karakter), mis. pelanggan belum bisa membayar.
   * Tidak perlu bila pembayaran sudah dicatat.
   */
  @IsOptional() @IsString() @MaxLength(500) unpaidReason?: string;
}
