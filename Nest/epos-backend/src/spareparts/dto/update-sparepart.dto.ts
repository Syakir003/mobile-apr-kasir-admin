import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
}
