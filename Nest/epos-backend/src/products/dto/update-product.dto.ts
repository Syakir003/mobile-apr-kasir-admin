import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// PATCH parsial — field sama dengan CreateProductDto. Stok & harga jual boleh
// diubah admin langsung (Supabase tidak melarang; form edit produk Flutter
// juga mengirim `stock`). Mutasi yang perlu jejak stock_movements: POST /stock/adjust.
export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsBoolean() inverter?: boolean;
  @IsOptional() @IsInt() btu?: number;
  @IsOptional() @IsInt() watt?: number;
  @IsOptional() @IsString() warranty?: string;
  @IsOptional() @IsInt() @Min(0) sellPrice?: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
