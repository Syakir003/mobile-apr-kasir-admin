import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// Field yang sama seperti CreateProductDto, semua opsional (PATCH parsial)
// KECUALI `stock` — itu TETAP gak ada di sini, satu-satunya jalur ubah stok
// StockService.stockIn() (bikin batch baru). `sellPrice` SEKARANG BOLEH
// diedit lewat sini (Siklus harga-seragam 2026-09-22) — ini satu-satunya
// tempat admin ubah harga jual produk, gak lagi lewat stock-in kayak sebelumnya.
export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsBoolean() inverter?: boolean;
  @IsOptional() @IsInt() btu?: number;
  @IsOptional() @IsInt() watt?: number;
  @IsOptional() @IsString() warranty?: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsNumber() @Min(0) sellPrice?: number;
  @IsOptional() @IsString() pairedProductId?: string;
  // BARU (Paket AC Split, 2026-09-30) — `null` = kosongin peran (produk
  // non-AC / belum ditentukan). Produk yang lagi berpasangan gak bisa
  // diubah perannya lewat sini (ditolak ProductsService.update).
  @IsOptional() @IsIn(['indoor', 'outdoor']) acRole?: 'indoor' | 'outdoor' | null;
  // Nonaktifin produk yang udah gak dijual lagi tanpa hapus riwayatnya —
  // sama polanya kayak UsersService.toggleActive, cuma gak butuh pengaman
  // anti-kunci-diri-sendiri (produk bukan akun).
  @IsOptional() @IsBoolean() active?: boolean;
}
