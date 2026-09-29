import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
  @IsIn(['rumah', 'perusahaan', 'toko'])
  customerType?: string;

  // Dikirim ulang (true) setelah admin/kasir confirm peringatan "nomor HP
  // ini udah kepake member lain" — pola sama kayak confirmOverride di
  // StockInDto (soft-warn + confirm, bukan blokir keras).
  @IsOptional()
  @IsBoolean()
  confirmOverride?: boolean;
}
