import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// Kolom = tabel `products` Supabase. Admin boleh mengisi sellPrice & stock
// langsung (RLS "products: tulis/ubah admin", tanpa grant kolom/trigger yang
// melarang) — sama dengan form produk Flutter. Harga modal TIDAK di sini:
// tabel `item_costs` (admin-only), lewat PUT /item-costs/product/:id.
export class CreateProductDto {
  @IsString() name: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() type?: string;
  // Validasi ringan anti salah ketik ("3435" alih-alih "3.5").
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
