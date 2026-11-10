import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Satu baris dalam daftar jasa setelah disesuaikan teknisi. Tiga bentuk:
 *  - `id` (baris yang sudah ada): hanya `qty` yang boleh berubah; harga/nama tetap milik admin.
 *  - `serviceId` (tambah dari katalog): harga = harga katalog; `unitPrice` bila dikirim harus sama.
 *  - `name` + `unitPrice` (jasa lain, di luar katalog): keduanya wajib.
 */
export class TechEditLineDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsNumber() @Min(0.01) qty: number;
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
}

export class TechEditLinesDto {
  // Daftar LENGKAP jasa setelah disesuaikan (baris yang tidak ikut dikirim = dihapus). Minimal satu baris.
  @ValidateNested({ each: true })
  @Type(() => TechEditLineDto)
  @ArrayMinSize(1, { message: 'Minimal satu baris jasa' })
  @ArrayMaxSize(30)
  lines: TechEditLineDto[];

  // Alasan penyesuaian (wajib, min. 5 karakter setelah dipangkas); tampil ke admin dan masuk audit.
  @IsString() @MaxLength(500) reason: string;
}
