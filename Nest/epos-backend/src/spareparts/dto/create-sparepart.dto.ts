import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Kolom = tabel `spareparts` Supabase. stock/minStock numeric (boleh pecahan,
// mis. meter pipa). Harga modal di PUT /item-costs/sparepart/:id.
export class CreateSparepartDto {
  @IsString() name: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() category?: string;
  @IsString() unit: string;
  @IsInt() @Min(0) sellPrice: number;
  @IsNumber() @Min(0) stock: number;
  @IsOptional() @IsNumber() @Min(0) minStock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
