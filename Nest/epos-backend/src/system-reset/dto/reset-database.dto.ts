import { IsIn, IsString } from 'class-validator';

// 3 tingkat cakupan reset database (fitur "Zona Bahaya" halaman Pengaturan,
// 2026-09-25) — dari yang paling ringan ke paling berat. Lihat plan
// docs/superpowers/plans/2026-09-25-reset-database-plan.md untuk daftar
// tabel per scope & urutan hapus FK-safe.
export type ResetScope = 'transaksi' | 'transaksi_pelanggan' | 'total';

export const RESET_SCOPES: ResetScope[] = [
  'transaksi',
  'transaksi_pelanggan',
  'total',
];

// Frasa yang HARUS diketik ulang persis (case-sensitive) sebelum reset
// dieksekusi — dicocokkan di SystemResetService.reset(), bukan cuma di DTO,
// biar validasinya gak bisa dilewatin walau request dirakit manual (mis.
// lewat Postman). Frontend nampilin frasa yang sama di dialog konfirmasi
// (src/components/pengaturan/reset-scope-dialog.tsx) — sengaja hardcode
// duplikat di 2 tempat, gak ada package shared antara backend & frontend.
export const RESET_CONFIRM_TEXT: Record<ResetScope, string> = {
  transaksi: 'HAPUS TRANSAKSI',
  transaksi_pelanggan: 'HAPUS TRANSAKSI PELANGGAN',
  total: 'HAPUS TOTAL',
};

export class ResetDatabaseDto {
  @IsIn(RESET_SCOPES)
  scope: ResetScope;

  @IsString()
  confirmText: string;
}
