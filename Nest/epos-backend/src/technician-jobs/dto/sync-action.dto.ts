import { IsIn, IsISO8601, IsObject, IsString, IsUUID } from 'class-validator';

// Siklus 9 — Mode Offline Teknisi. Vokabuler action DISESUAIKAN sama sistem
// checklist DINAMIS Siklus 5 revisi (JobFinding), BUKAN checklist tetap yang
// disangka plan draft awal proyek ini ('checklist_toggle' gak pernah ada di
// sistem ini — lihat TechnicianJobsService, tidak ada tabel/kolom apapun
// buat itu). Foto juga TIDAK punya action type sendiri di sini — foto
// ditulis LANGSUNG & idempoten lewat endpoint multipart yang sudah ada
// (POST /technician-jobs/:id/findings/:findingId/photos, di-extend dikit di
// siklus ini buat terima clientActionId opsional), jadi gak ada "tahap 2"
// yang perlu dikonfirmasi lewat sync-batch — beda dari draft rencana awal.
export type SyncActionType = 'finding_add' | 'material_add' | 'notes_update' | 'submit_for_review';

const SYNC_ACTION_TYPES: SyncActionType[] = [
  'finding_add',
  'material_add',
  'notes_update',
  'submit_for_review',
];

/**
 * Bentuk `payload` per `type` (kontrak dengan Flutter — divalidasi manual di
 * OfflineSyncService karena `payload` sengaja generic, tiap type beda shape):
 * - finding_add       → { categoryId?: string; categoryName?: string; note?: string }
 * - material_add       → { items: { kind: 'sparepart'; refId: string; qty: number }[]; note?: string }
 *   (Siklus batch-cost 2026-09: kind='product' DICABUT dari scope pengajuan
 *   material — lihat MaterialRequestItemDto & OfflineSyncService.dispatch)
 * - notes_update       → { notes: string }
 * - submit_for_review  → {} (gak butuh payload tambahan)
 */
export class SyncActionDto {
  @IsUUID() clientActionId: string;
  @IsIn(SYNC_ACTION_TYPES) type: SyncActionType;
  @IsString() jobId: string;
  // Timestamp job.updatedAt di sisi klien SAAT aksi ini dibuat offline (hasil
  // cache dari GET /technician-jobs/queue/today-bundle) — dipakai deteksi
  // konflik, lihat OfflineSyncService.
  @IsISO8601() clientUpdatedAt: string;
  @IsObject() payload: Record<string, unknown>;
}
