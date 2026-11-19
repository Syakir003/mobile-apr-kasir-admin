import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Teknisi memindai barcode unit untuk mengisi satu slot "unit belum diketahui" (POST /technician-jobs/:id/claim-unit). */
export class ClaimUnitDto {
  @IsString() @IsNotEmpty() @MaxLength(200) barcode: string;
}
