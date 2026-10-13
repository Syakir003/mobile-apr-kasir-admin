import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { SPAREPART_MODES } from '../sparepart-mode.util';

// Sama seperti CreateSparepartDto, semua opsional (PATCH parsial) — KECUALI
// `stock`. Alasan sama seperti UpdateProductDto: stok cuma boleh dimutasi
// lewat StockService (stockIn/opname) biar StockMovement-nya konsisten.
export class UpdateSparepartDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() @Min(0) sellPrice?: number;
  @IsOptional() @IsNumber() @Min(0) minStock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  // Siklus sparepart-per-gulungan (2026-09-23) — admin boleh toggle kapan
  // aja (bukan cuma pas create). Nge-toggle TIDAK migrasi data item_costs
  // yang udah ada — lihat catatan invarian di schema.prisma model Sparepart.
  @IsOptional() @IsBoolean() batchTracked?: boolean;

  // BARU (2026-09-30) — lihat CreateSparepartDto.
  @IsOptional() @IsIn(SPAREPART_MODES as unknown as string[]) trackingMode?: string;
  @IsOptional() @IsString() packUnit?: string;
  @IsOptional() @IsNumber() @Min(0.01) packSize?: number;
  @IsOptional() @IsNumber() @Min(0) sellPricePack?: number;

  // Harga per tipe pembeli (2026-10-13). sellPrice/sellPricePack = harga
  // Ritel. price* = eceran per `unit`, pricePack* = utuh per `packUnit`.
  // `null` = kosongkan (tipe itu jadi tidak bisa membeli sparepart ini).
  @IsOptional() @IsNumber() @Min(0) priceInstaller?: number | null;
  @IsOptional() @IsNumber() @Min(0) priceReseller?: number | null;
  @IsOptional() @IsNumber() @Min(0) pricePackInstaller?: number | null;
  @IsOptional() @IsNumber() @Min(0) pricePackReseller?: number | null;
}
