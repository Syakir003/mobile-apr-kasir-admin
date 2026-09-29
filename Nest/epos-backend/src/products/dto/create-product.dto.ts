import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() name: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() type?: string;
  // Kolom `products.pk` di DB itu DECIMAL(4,2) — maks 99.99. Divalidasi di
  // sini biar input ngawur (misal salah ketik "3435" instead of "3.5")
  // ditolak 400 yang jelas, bukan nge-crash 500 gara-gara numeric overflow di Postgres.
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsBoolean() inverter?: boolean;
  @IsOptional() @IsInt() btu?: number;
  @IsOptional() @IsInt() watt?: number;
  @IsOptional() @IsString() category?: string;
  // sellPrice & stock DIHAPUS (Siklus batch-cost 2026-09) — harga jual &
  // stok sekarang selalu datang dari batch (item_costs), diisi lewat
  // StockService.stockIn() SETELAH produk ini dibuat. Produk baru mulai
  // dengan 0 batch/0 stok sampai di-stock-in.
}
