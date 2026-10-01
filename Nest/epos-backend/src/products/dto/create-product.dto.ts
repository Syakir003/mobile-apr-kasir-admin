import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

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
  // Siklus harga-seragam (2026-09-22) — sellPrice BALIK jadi field di sini
  // (sempat dihapus di siklus batch-cost, pindah ke per-batch). Wajib diisi
  // saat produk dibuat — inilah satu-satunya harga jual produk ini,
  // berlaku ke SEMUA batch (beda supplier/kedatangan cuma beda modal, harga
  // jualnya tetap 1). `stock` TETAP gak ada di sini — produk baru mulai
  // dengan 0 stok sampai di-stock-in lewat StockService.stockIn().
  @IsNumber() @Min(0) sellPrice: number;
  // BARU (Point 2, 2026-09-23) — id Product Outdoor pasangan (kalau produk
  // ini Indoor-nya sebuah unit AC 2-komponen). Opsional — mayoritas produk
  // (sparepart-terpisah, produk non-AC) gak butuh ini sama sekali.
  @IsOptional() @IsString() pairedProductId?: string;
  // BARU (Paket AC Split, 2026-09-30) — peran unit AC ('indoor' |
  // 'outdoor'), diisi otomatis dari pilihan "Jenis Input" di Master Data.
  // Kalau pairedProductId keisi, server MAKSA 'indoor' buat produk ini &
  // 'outdoor' buat pasangannya (lihat ProductsService.syncPairRoles).
  @IsOptional() @IsIn(['indoor', 'outdoor']) acRole?: 'indoor' | 'outdoor';
}
