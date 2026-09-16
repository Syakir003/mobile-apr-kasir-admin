import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TechnicianJobsService } from './technician-jobs.service';
import { MaterialRequestsService } from '../material-requests/material-requests.service';
import { SyncActionDto } from './dto/sync-action.dto';

type SyncStatus = 'applied' | 'skipped_duplicate' | 'conflict' | 'error';
type SyncResult = { clientActionId: string; status: SyncStatus; detail: unknown };
// 'pending' CUMA muncul di sync_action_log.result selagi sebuah klaim masih
// diproses (lihat claim()) — gak pernah dibalikin ke caller sebagai
// SyncResult.status (selalu diterjemahkan ke 'error'/'skipped_duplicate'
// dulu). Union terpisah biar SyncResult tetap ketat cuma 4 status final.
type StoredStatus = SyncStatus | 'pending';
type StoredResult = { status: StoredStatus; detail: unknown };

/**
 * Siklus 9 — Mode Offline Teknisi (backend). Tidak ada logic bisnis baru di
 * sini — service ini murni MEMBUNGKUS method-method yang sudah ada &
 * teruji di TechnicianJobsService/MaterialRequestsService (Siklus 1, 2, 5)
 * jadi bisa dipanggil BATCH & IDEMPOTEN. Lihat komentar di
 * dto/sync-action.dto.ts soal kenapa vokabuler action-nya beda dari draft
 * plan awal (checklist dinamis JobFinding, bukan checklist tetap).
 */
@Injectable()
export class OfflineSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: TechnicianJobsService,
    private readonly materialRequests: MaterialRequestsService,
  ) {}

  async processSyncBatch(actions: SyncActionDto[], technicianId: string): Promise<SyncResult[]> {
    const jobIds = [...new Set(actions.map((a) => a.jobId))];
    const jobs = await this.prisma.technicianJob.findMany({ where: { id: { in: jobIds } } });
    const jobMap = new Map(jobs.map((j) => [j.id, j]));

    // Snapshot SEKALI di awal batch, BUKAN di-refresh di tengah loop — kalau
    // 2 action di batch yang sama nyentuh job yang sama (mis. finding_add lalu
    // notes_update buat job X, keduanya dibuat offline dengan clientUpdatedAt
    // sama persis), action pertama yang berhasil diproses TIDAK BOLEH bikin
    // action kedua keliatan "basi" cuma gara-gara urutan pemrosesan internal
    // batch ini sendiri. Konflik SEHARUSNYA cuma kedeteksi kalau ada
    // perubahan dari LUAR batch ini (mis. admin re-assign job ke teknisi lain
    // sementara teknisi masih offline di lapangan).
    const baselineUpdatedAt = new Map(jobs.map((j) => [j.id, j.updatedAt]));

    const results: SyncResult[] = [];
    for (const action of actions) {
      results.push(await this.processOne(action, technicianId, jobMap, baselineUpdatedAt));
    }
    return results;
  }

  private async processOne(
    action: SyncActionDto,
    technicianId: string,
    jobMap: Map<string, { id: string; technicianId: string | null }>,
    baselineUpdatedAt: Map<string, Date>,
  ): Promise<SyncResult> {
    // 1) Klaim clientActionId ini duluan (INSERT dulu, bukan cek-baru-insert
    //    — lihat claim() buat alasan lengkapnya soal race-nya). Ini yang
    //    bikin retry seluruh batch aman (Flutter gak selalu tahu apakah
    //    batch sebelumnya beneran sukses diproses server atau putus di
    //    tengah jalan pas nunggu respons) SEKALIGUS aman dari 2 request
    //    identik yang nabrak BARENGAN (bukan cuma retry berurutan).
    const claim = await this.claim(action.clientActionId, action.jobId, action.type);
    if (!claim.claimed) {
      const cached: StoredResult | null = claim.cached;
      if (!cached || cached.status === 'pending') {
        // Klaim punya request lain masih diproses (atau baru aja macet tapi
        // belum ngelewatin ambang stale) — jangan dianggap final, biar
        // client retry lagi nanti alih-alih nyimpen 'error' permanen.
        return { clientActionId: action.clientActionId, status: 'error', detail: { message: 'Aksi ini lagi diproses permintaan lain, coba lagi sebentar' } };
      }
      return { clientActionId: action.clientActionId, status: 'skipped_duplicate', detail: cached.detail };
    }

    const job = jobMap.get(action.jobId);
    if (!job) {
      await this.releaseClaim(action.clientActionId);
      return { clientActionId: action.clientActionId, status: 'error', detail: { message: 'Job tidak ditemukan' } };
    }
    if (job.technicianId !== technicianId) {
      await this.releaseClaim(action.clientActionId);
      return {
        clientActionId: action.clientActionId,
        status: 'error',
        detail: { message: 'Job ini bukan milik teknisi ini' },
      };
    }

    // 2) Deteksi konflik pakai baseline, BUKAN updatedAt live.
    const baseline = baselineUpdatedAt.get(action.jobId)!;
    const clientUpdatedAt = new Date(action.clientUpdatedAt);
    if (clientUpdatedAt < baseline) {
      return this.completeClaim(action, 'conflict', {
        message: 'Job berubah di server sejak aksi ini dibuat offline (mis. re-assign teknisi lain)',
        serverUpdatedAt: baseline,
      });
    }

    // 3) Eksekusi — REUSE method existing, SATU-SATU (bukan 1 transaction
    //    besar buat seluruh batch — 1 action gagal, mis. sparepart keburu
    //    habis, gak boleh bikin action lain di batch yang sama ikut mental).
    try {
      const detail = await this.dispatch(action, technicianId);
      return this.completeClaim(action, 'applied', detail);
    } catch (err: any) {
      // Lepas klaimnya (hapus row 'pending') — SENGAJA TIDAK dicatat sebagai
      // hasil final ke sync_action_log, kalau errornya transient (mis. DB
      // sempat down) retry berikutnya harus beneran nyoba lagi, bukan
      // langsung ke-skip selamanya karena udah "tercatat".
      await this.releaseClaim(action.clientActionId);
      return { clientActionId: action.clientActionId, status: 'error', detail: { message: err?.message ?? 'Gagal diproses' } };
    }
  }

  private async dispatch(action: SyncActionDto, technicianId: string): Promise<unknown> {
    switch (action.type) {
      case 'finding_add': {
        const { categoryId, categoryName, note } = action.payload as {
          categoryId?: string;
          categoryName?: string;
          note?: string;
        };
        return this.jobsService.addFinding(action.jobId, { categoryId, categoryName, note }, technicianId, 'teknisi');
      }
      case 'material_add': {
        // Siklus batch-cost (2026-09): kind='product' DICABUT dari scope
        // pengajuan material (lihat MaterialRequestItemDto) — jalur offline
        // sync ini manggil MaterialRequestsService.create() yang sama, jadi
        // tipe payload di sini HARUS ikut disempitin biar sinkron sama DTO.
        // Kalau app mobile lama masih ngirim 'product', bakal ke-reject
        // eksplisit di priceItems() (BadRequestException) — bukan silent.
        const { items, note } = action.payload as {
          items: { kind: 'sparepart'; refId: string; qty: number }[];
          note?: string;
        };
        if (!Array.isArray(items) || items.length === 0) {
          throw new Error('material_add butuh minimal 1 item {kind, refId, qty}');
        }
        return this.materialRequests.create(action.jobId, { items, note }, technicianId, 'teknisi');
      }
      case 'notes_update': {
        const { notes } = action.payload as { notes: string };
        return this.jobsService.updateNotes(action.jobId, notes, technicianId, 'teknisi');
      }
      case 'submit_for_review': {
        return this.jobsService.submitForReview(action.jobId, technicianId, 'teknisi');
      }
    }
  }

  private async completeClaim(
    action: SyncActionDto,
    status: 'applied' | 'conflict',
    detail: unknown,
  ): Promise<SyncResult> {
    await this.prisma.syncActionLog.update({
      where: { clientActionId: action.clientActionId },
      // `detail` sengaja unknown (bisa job/array/apa aja tergantung jenis
      // action) — di-cast ke Prisma.InputJsonValue di titik nulis DB aja
      // (bukan diketik unknown->Json global), karena di sinilah kontrak
      // sebenarnya: kolomnya emang Json, isinya harus JSON-serializable.
      data: { result: { status, detail } as Prisma.InputJsonValue },
    });
    return { clientActionId: action.clientActionId, status, detail };
  }

  // Klaim 'pending' yang macet lebih lama dari ini dianggap punya request
  // sebelumnya yang crash di tengah jalan (bukan lagi beneran diproses) —
  // boleh direbut ulang. 2 menit jauh di atas waktu wajar 1 action selesai.
  private static readonly STALE_CLAIM_MS = 2 * 60 * 1000;

  // ---------------------------------------------------------------------
  // claim/completeClaim/releaseClaim: INSERT row sync_action_log DULU
  // (status 'pending') SEBELUM eksekusi side effect apa pun — row itu
  // sendiri yang jadi "kunci" (unique constraint di client_action_id yang
  // ditegakkan Postgres). Ini gantiin pola lama (cek findUnique dulu, baru
  // insert belakangan setelah eksekusi) yang punya celah TOCTOU: 2 request
  // ber-clientActionId SAMA yang nabrak BARENGAN (bukan cuma retry
  // berurutan — mis. client timeout lalu auto-retry sementara request
  // pertama masih diproses server) bisa dua-duanya lolos cek "belum ada
  // log", dua-duanya eksekusi side effect (JobFinding/MaterialRequest/foto
  // kecatet dobel), dan cuma salah satu yang menang pas nulis log-nya —
  // yang kalah malah nge-throw P2002 unhandled kalau gak ditangkep manual
  // di tiap caller. Dengan INSERT-first, Postgres yang menjamin cuma SATU
  // request yang berhak jalanin dispatch(); yang kalah gak nyentuh side
  // effect sama sekali.
  // ---------------------------------------------------------------------

  private async claim(
    clientActionId: string,
    jobId: string,
    actionType: string,
  ): Promise<{ claimed: true } | { claimed: false; cached: StoredResult | null }> {
    try {
      await this.prisma.syncActionLog.create({
        data: { clientActionId, jobId, actionType, result: { status: 'pending', detail: null } },
      });
      return { claimed: true };
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      const row = await this.prisma.syncActionLog.findUnique({ where: { clientActionId } });
      if (!row) return { claimed: false, cached: null }; // race lain barusan hapus row-nya — anggap gak ada, biar caller retry wajar
      const result = row.result as StoredResult;
      const ageMs = Date.now() - row.processedAt.getTime();
      if (result.status === 'pending' && ageMs > OfflineSyncService.STALE_CLAIM_MS) {
        // Klaim lama yang macet (request sebelumnya kemungkinan crash
        // sebelum sempat completeClaim/releaseClaim) — hapus & rebut ulang.
        await this.prisma.syncActionLog.delete({ where: { clientActionId } }).catch(() => {});
        return this.claim(clientActionId, jobId, actionType);
      }
      return { claimed: false, cached: result };
    }
  }

  private async releaseClaim(clientActionId: string) {
    await this.prisma.syncActionLog.delete({ where: { clientActionId } }).catch(() => {});
  }

  // ---------------------------------------------------------------------
  // Dipakai TechnicianJobsController buat extend endpoint upload foto temuan
  // yang sudah ada (POST .../findings/:findingId/photos) — dedup pakai
  // sync_action_log yang SAMA PERSIS dengan sync-batch (claim/release di
  // atas), biar upload foto pun aman di-retry ATAU nabrak bareng.
  // ---------------------------------------------------------------------

  async claimPhotoUpload(clientActionId: string, jobId: string) {
    return this.claim(clientActionId, jobId, 'finding_photo_upload');
  }

  async completePhotoUpload(clientActionId: string, photo: unknown) {
    await this.prisma.syncActionLog.update({
      where: { clientActionId },
      data: { result: { status: 'applied', detail: photo } as Prisma.InputJsonValue },
    });
  }

  async releasePhotoUpload(clientActionId: string) {
    await this.releaseClaim(clientActionId);
  }
}
