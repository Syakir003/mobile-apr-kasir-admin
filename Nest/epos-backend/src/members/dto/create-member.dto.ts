import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PRICE_TIERS } from '../../common/price-tier.util';
import type { PriceTierName } from '../../common/price-tier.util';

// Form "Tambah Member" manual (halaman /members) — sebelumnya Member CUMA
// kebentuk otomatis lewat MembersService.findOrCreate (checkout POS/servis),
// gak ada cara admin/kasir daftarin pelanggan duluan sebelum transaksi.
export class CreateMemberDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  // Opsional — beda dari findOrCreate (checkout) yang emang selalu ada
  // nomor dari form transaksi, di sini bisa aja pelanggan belum kasih HP.
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\/\S+$/i, { message: 'Link lokasi harus diawali http:// atau https://' })
  mapsUrl?: string;

  @IsOptional()
  @IsIn(['rumah', 'perusahaan', 'toko'])
  customerType?: string;

  // Tipe pembeli (2026-10-13) — kosong = Ritel. Boleh diisi kasir SAAT
  // membuat member; mengubahnya belakangan khusus admin (PATCH price-tier).
  @IsOptional()
  @IsIn(PRICE_TIERS as unknown as string[])
  priceTier?: PriceTierName;

  // Dikirim ulang (true) setelah admin/kasir confirm peringatan "nomor HP
  // ini udah kepake member lain" — pola sama kayak confirmOverride di
  // StockInDto (soft-warn + confirm, bukan blokir keras).
  @IsOptional()
  @IsBoolean()
  confirmOverride?: boolean;
}
