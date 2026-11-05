import { IsString, MaxLength } from 'class-validator';

/** Keterangan teknisi untuk SATU ORDER (`PATCH /technician-jobs/:id/keterangan`). Kosong = hapus. */
export class UpdateKeteranganDto {
  @IsString() @MaxLength(1000) keterangan: string;
}
