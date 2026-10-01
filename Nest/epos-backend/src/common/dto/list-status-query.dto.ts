import { IsIn, IsOptional } from 'class-validator';

export type ListStatus = 'active' | 'inactive' | 'all';

// Query param `status` buat findAll() 4 module Master Data (Product,
// Sparepart, Service, InstallationPackage) — dipakai fitur nonaktifkan
// (soft-delete) Master Data (2026-09-25). Default (gak dikirim) TETAP
// 'active' biar konsumen lama (POS, dropdown pemilihan sparepart/paket
// di form Paket Instalasi) gak berubah perilakunya.
export class ListStatusQueryDto {
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: ListStatus;
}
