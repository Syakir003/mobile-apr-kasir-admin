import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// Field yang sama seperti CreateProductDto, semua opsional (PATCH parsial)
// KECUALI `stock` DAN (Siklus batch-cost 2026-09) `sellPrice` — dua-duanya
// udah gak ada lagi di tabel `products` (pindah ke `item_costs` per-batch).
// Satu-satunya jalur ubah harga jual sekarang StockService.stockIn() (bikin
// batch baru) — biar tiap perubahan harga/stok selalu ninggalin jejak
// StockMovement/batch, gak ada 2 jalur mutasi yang gak sinkron.
export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(99.99) pk?: number;
  @IsOptional() @IsBoolean() inverter?: boolean;
  @IsOptional() @IsInt() btu?: number;
  @IsOptional() @IsInt() watt?: number;
  @IsOptional() @IsString() warranty?: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  // Nonaktifin produk yang udah gak dijual lagi tanpa hapus riwayatnya —
  // sama polanya kayak UsersService.toggleActive, cuma gak butuh pengaman
  // anti-kunci-diri-sendiri (produk bukan akun).
  @IsOptional() @IsBoolean() active?: boolean;
}
