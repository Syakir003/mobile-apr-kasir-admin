import { IsIn, IsOptional } from 'class-validator';

// Query buat halaman admin "Pengajuan Masuk" — daftar SEMUA pengajuan
// sparepart tambahan lintas job/teknisi (beda dari materialRequests yang
// udah nempel di GET /technician-jobs/:id, yang scope-nya cuma 1 job).
// Volume-nya jauh lebih kecil dari audit log (pengajuan gak setiap hari),
// jadi sengaja TANPA pagination dulu — kalau nanti kepanjangan tinggal
// nyusul pola page/pageSize kayak AuditLogQueryDto.
export class MaterialRequestQueryDto {
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: 'pending' | 'approved' | 'rejected';
}
