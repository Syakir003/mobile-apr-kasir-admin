import { Type } from 'class-transformer';
import { ArrayMinSize, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class MaterialRequestItemDto {
  // Siklus batch-cost (2026-09): kind='product' DICABUT dari scope pengajuan
  // material. Alasan: teknisi butuh AC unit baru di tengah servis itu
  // fungsinya sama persis kayak checkout biasa (yang udah punya UI pemilihan
  // batch + alur instalasi sendiri) — pengajuan material gak punya UI pilih
  // batch sama sekali, jadi kalau tetap dibolehin, harga yang dipatok pas
  // pengajuan bisa beda dari batch yang beneran kepotong pas markUsed()
  // (lihat histori diskusi 2026-09-08). Nyabut 'product' dari sini nutup
  // gap itu total, bukan cuma minimalisir.
  @IsIn(['sparepart']) kind: 'sparepart';
  @IsString() @IsNotEmpty() refId: string;
  @IsNumber() @Min(0.01) qty: number;
}

export class CreateMaterialRequestDto {
  @ValidateNested({ each: true })
  @Type(() => MaterialRequestItemDto)
  @ArrayMinSize(1)
  items: MaterialRequestItemDto[];

  @IsOptional() @IsString() note?: string;
}
