import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { SPAREPART_MODES } from '../sparepart-mode.util';

export class CreateSparepartDto {
  @IsString() name: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() category?: string;
  @IsString() unit: string;
  @IsNumber() @Min(0) sellPrice: number;
  @IsNumber() @Min(0) stock: number;
  @IsOptional() @IsNumber() @Min(0) minStock?: number;
  // Siklus sparepart-per-gulungan (2026-09-23) — opsional, default false
  // (di service, lihat SparepartsService.create). true = sparepart ini
  // dilacak per-gulungan/batch (FIFO kayak Produk) — biasanya buat barang
  // yang dijual per-meter dengan panjang beda-beda tiap kedatangan.
  @IsOptional() @IsBoolean() batchTracked?: boolean;

  // BARU (2026-09-30) — mode pelacakan & penjualan: biasa | gulungan |
  // konversi | gabungan. Gak dikirim => diturunin dari `batchTracked`
  // (klien lama). Field kemasan di bawah wajib buat konversi/gabungan
  // (divalidasi resolveSparepartMode). `unit` = satuan KECIL (m/kg/pcs),
  // `sellPrice` = harga eceran per `unit`.
  @IsOptional() @IsIn(SPAREPART_MODES as unknown as string[]) trackingMode?: string;
  @IsOptional() @IsString() packUnit?: string;
  @IsOptional() @IsNumber() @Min(0.01) packSize?: number;
  @IsOptional() @IsNumber() @Min(0) sellPricePack?: number;
}
