import { IsBoolean, IsOptional } from 'class-validator';

/** Body opsional `PATCH /technician-jobs/:id/cancel`. */
export class CancelJobDto {
  /**
   * Servis banyak AC (halaman web satu job, banyak unit): pengajuan sparepart dipakai bersama seluruh unit dan
   * melekat pada salah satu unitnya. Dengan flag ini, kalau unit yang dibatalkan memegang pengajuan dan masih ada
   * unit lain yang aktif, pengajuannya dipindah ke unit aktif berikutnya (bukan ikut dibatalkan). Tanpa flag
   * (app mobile, job satu unit) perilakunya tidak berubah: pengajuan job itu ikut dibatalkan.
   */
  @IsOptional() @IsBoolean() moveRequestsToSibling?: boolean;
}
