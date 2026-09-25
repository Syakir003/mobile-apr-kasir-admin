import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// PATCH parsial. `stock` boleh diubah admin langsung — Supabase tidak
// melarang (RLS "spareparts: ubah admin") dan form edit Flutter mengirimnya.
// Mutasi yang perlu jejak stock_movements: POST /stock/adjust.
export class UpdateSparepartDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsInt() @Min(0) sellPrice?: number;
  @IsOptional() @IsNumber() @Min(0) stock?: number;
  @IsOptional() @IsNumber() @Min(0) minStock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
