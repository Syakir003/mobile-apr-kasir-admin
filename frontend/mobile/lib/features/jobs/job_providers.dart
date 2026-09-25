import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/router/app_router.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../data/models/app_user.dart';
import '../../data/models/invoice.dart';
import '../../data/models/job_history_extra.dart';
import '../../data/models/job_photo.dart';
import '../../data/models/material_request.dart';
import '../../data/models/service_order.dart';
import '../../data/models/technician_job.dart';
import '../../data/repositories/job_repository.dart';

const _api = ApiClient();

final jobRepositoryProvider = Provider<JobRepository>(
  (ref) => NestJobRepository(_api),
);

/// Daftar job untuk pengguna aktif: teknisi hanya melihat job miliknya,
/// admin/kasir melihat seluruh job. Kosong bila belum ada sesi. Segarkan
/// dengan `ref.invalidate(jobsForCurrentUserProvider)` setelah perubahan.
final jobsForCurrentUserProvider =
    FutureProvider.autoDispose<List<TechnicianJob>>((ref) async {
  final user = ref.watch(currentUserProvider).value;
  final repo = ref.watch(jobRepositoryProvider);
  if (user == null) return const [];
  return user.role == UserRole.teknisi
      ? repo.fetchJobs(technicianId: user.uid)
      : repo.fetchJobs();
});

/// Riwayat job untuk satu unit AC (terbaru dulu), lintas teknisi & order.
/// Semua peran boleh membaca (RLS `technician_jobs` = semua user login).
final unitJobHistoryProvider =
    FutureProvider.autoDispose.family<List<TechnicianJob>, String>(
  (ref, unitId) => ref.watch(jobRepositoryProvider).fetchJobsByUnit(unitId),
);

/// Riwayat satu unit AC, lengkap dengan ringkasan foto & material per entri.
///
/// Digabung dalam satu provider (bukan satu provider per job) supaya layar
/// riwayat cukup menunggu sekali dan tidak menembakkan dua query per baris.
typedef UnitHistory = ({
  List<TechnicianJob> jobs,
  Map<String, JobHistoryExtra> extras,
});

final unitHistoryProvider =
    FutureProvider.autoDispose.family<UnitHistory, String>((ref, unitId) async {
  final repo = ref.watch(jobRepositoryProvider);
  final jobs = await repo.fetchJobsByUnit(unitId);
  final extras =
      await repo.fetchHistoryExtras([for (final j in jobs) j.id]);
  return (jobs: jobs, extras: extras);
});

/// Satu job by id (family). Null bila tidak ada.
final jobProvider = FutureProvider.autoDispose.family<TechnicianJob?, String>(
  (ref, id) => ref.watch(jobRepositoryProvider).fetchJobById(id),
);

/// Foto bukti (sebelum/sesudah) untuk satu job. Segarkan dengan
/// `ref.invalidate(jobPhotosProvider(jobId))` setelah unggah.
final jobPhotosProvider =
    FutureProvider.autoDispose.family<List<JobPhoto>, String>(
  (ref, jobId) => ref.watch(jobRepositoryProvider).fetchPhotos(jobId),
);

/// Signed URL sementara untuk menampilkan foto pada object [path].
final signedPhotoUrlProvider =
    FutureProvider.autoDispose.family<String, String>(
  (ref, path) => ref.watch(jobRepositoryProvider).signedPhotoUrl(path),
);

// `add_job_photo` RPC DIHAPUS (bukan cuma dipindah) — `NestJobRepository
// .uploadPhoto` di atas sudah melakukan upload BINER + catat metadata dalam
// SATU panggilan multipart (`POST /technician-jobs/:id/photos`), jadi tak
// ada lagi langkah "catat metadata" terpisah setelah upload. Lihat
// job_detail_screen.dart `_PhotosSectionState._add` yang sudah disesuaikan
// (tidak lagi memanggil provider kedua setelah `uploadPhoto`).

/// Pengajuan tambahan untuk satu job. Segarkan dengan
/// `ref.invalidate(jobRequestsProvider(jobId))` setelah submit/putusan.
final jobRequestsProvider =
    FutureProvider.autoDispose.family<List<MaterialRequest>, String>(
  (ref, jobId) => ref.watch(jobRepositoryProvider).fetchRequests(jobId),
);

/// `POST /technician-jobs/:jobId/materials` (teknisi mengajukan tambahan) —
/// pengganti RPC `submit_material_request`. Bentuk payload (`items` berisi
/// `{kind, refId, qty}`, `note` opsional) sudah cocok 1:1 dengan
/// `CreateMaterialRequestDto`.
///
/// CATATAN: backend sejak siklus batch-cost (2026-09) hanya menerima
/// `kind: 'sparepart'` (`kind: 'product'` DICABUT dari scope pengajuan
/// material, lihat DTO Nest) — `job_requests_section.dart`'s `_ItemPickerSheet`
/// masih menawarkan item `kind: 'product'`. Ini gap pre-existing dari
/// pekerjaan paralel lain (bukan diperkenalkan migrasi ini), disebut di
/// laporan migrasi.
Future<void> callSubmitMaterialRequest(
  Map<String, dynamic> payload, {
  required Future<dynamic> Function(String path, {Object? body}) post,
}) {
  return post('/technician-jobs/${payload['jobId']}/materials', body: {
    'items': payload['items'],
    if (payload['note'] != null) 'note': payload['note'],
  });
}

final submitRequestCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) => callSubmitMaterialRequest(payload, post: _api.post);
});

/// `PATCH /material-requests/:id/decide` (admin approve/revise/reject) —
/// pengganti RPC `decide_material_request`. Dua penyesuaian bentuk terhadap
/// payload lama:
/// - key `note` -> `decisionNote` (nama field `DecideMaterialRequestDto`).
/// - `items` (kalau ada, hanya saat decision='revise') HARUS sudah berbentuk
///   `{kind, refId, qty}` per item (daftar PENGGANTI utuh, bukan patch
///   `{itemId, qty}` per item lama) — transformasi ini dilakukan di
///   `job_requests_section.dart._reviseThenApprove` (satu-satunya pemanggil),
///   karena cuma di sana `kind`/`refId` item asli tersedia.
Future<void> callDecideMaterialRequest(
  Map<String, dynamic> payload, {
  required Future<dynamic> Function(String path, {Object? body}) patch,
}) {
  return patch('/material-requests/${payload['requestId']}/decide', body: {
    'decision': payload['decision'],
    if (payload['note'] != null) 'decisionNote': payload['note'],
    if (payload['items'] != null) 'items': payload['items'],
  });
}

final decideRequestCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) => callDecideMaterialRequest(payload, patch: _api.patch);
});

/// `PATCH /material-requests/:id/mark-used` — pengganti RPC
/// `mark_material_used` (teknisi pemilik/admin menandai material dipakai →
/// stok baru dipotong di sini, sisi Nest).
Future<void> callMarkMaterialUsed(
  Map<String, dynamic> payload, {
  required Future<dynamic> Function(String path, {Object? body}) patch,
}) {
  return patch('/material-requests/${payload['requestId']}/mark-used');
}

final markMaterialUsedCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) => callMarkMaterialUsed(payload, patch: _api.patch);
});

/// Daftar order service (admin/kasir).
final ordersProvider =
    FutureProvider.autoDispose<List<ServiceOrder>>(
  (ref) => ref.watch(jobRepositoryProvider).fetchOrders(),
);

/// RPC `create_service_order` — admin/kasir menjadwalkan order manual
/// (service/maintenance/cuci) pada unit AC member yang sudah ada.
///
/// TETAP di Supabase (BUKAN dipindah) — `POST /service-orders/intake` bukan
/// pengganti yang sepadan, bentuknya beda secara mendasar, bukan cuma nama
/// field:
/// - Payload ini kirim `unitIds` (BANYAK unit sekaligus, `_unitIds.toList()`
///   dari `service_order_create_screen.dart`); `ServiceIntakeDto` cuma
///   menerima SATU unit per order (`existingUnitId` xor `newUnit`).
/// - Payload ini kirim `memberId` (member sudah ada); `ServiceIntakeDto`
///   mewajibkan `customer: {name, phone, address?}` (alur intake pelanggan
///   BARU/walk-in) + `complaint` wajib diisi — form ini tidak mengumpulkan
///   keduanya (member sudah dipilih dari daftar, keluhan opsional).
/// Memaksakan pemetaan 1:1 di sini akan mengubah semantik order manual
/// multi-unit jadi intake single-unit — bukan migrasi, tapi menulis ulang
/// fitur. Dibiarkan sebagai gap yang jelas (lihat laporan migrasi) sampai ada
/// keputusan produk: form ini dipecah per-unit, atau `ServiceIntakeDto`
/// diperluas menerima banyak unit dari member yang sudah ada.
final createServiceOrderCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('create_service_order', params: {'payload': payload});
  };
});

/// `PATCH /technician-jobs/:id/assign` — pengganti RPC `assign_technician_job`.
Future<void> callAssignTechnician(
  Map<String, dynamic> payload, {
  required Future<dynamic> Function(String path, {Object? body}) patch,
}) {
  return patch('/technician-jobs/${payload['jobId']}/assign',
      body: {'technicianId': payload['technicianId']});
}

final assignTechnicianCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) => callAssignTechnician(payload, patch: _api.patch);
});

/// Ringkasan tagihan di balik satu job.
///
/// [hasInvoice] false untuk job dari order manual yang memang belum ditagih.
/// Diambil lewat RPC `job_payment_info` (SECURITY DEFINER) karena teknisi
/// tidak punya akses baca tabel `invoices`.
typedef JobPaymentInfo = ({
  bool hasInvoice,
  String invoiceId,
  String number,
  InvoiceStatus status,
  int grandTotal,
  int totalPaid,
  int outstanding,
});

final jobPaymentInfoProvider =
    FutureProvider.autoDispose.family<JobPaymentInfo, String>(
  (ref, jobId) async {
    final res = await ref.read(supabaseProvider).rpc(
      'job_payment_info',
      params: {
        'payload': {'jobId': jobId},
      },
    );
    final m = (res as Map).cast<String, dynamic>();
    if (m['hasInvoice'] != true) {
      return (
        hasInvoice: false,
        invoiceId: '',
        number: '',
        status: InvoiceStatus.belumDibayar,
        grandTotal: 0,
        totalPaid: 0,
        outstanding: 0,
      );
    }
    return (
      hasInvoice: true,
      invoiceId: '${m['invoiceId']}',
      number: '${m['number']}',
      status: InvoiceStatus.fromValue(m['status']),
      grandTotal: (m['grandTotal'] as num?)?.toInt() ?? 0,
      totalPaid: (m['totalPaid'] as num?)?.toInt() ?? 0,
      outstanding: (m['outstanding'] as num?)?.toInt() ?? 0,
    );
  },
);

/// Pengganti RPC `update_technician_job_status` — tiap `action` dulunya satu
/// RPC dengan payload `{jobId, action, notes?, scannedBarcode?}`, sekarang
/// rute Nest terpisah per aksi. Murni (tanpa Riverpod) supaya routing-nya
/// bisa diuji tanpa mock HTTP, pola sama seperti `acUnitRowFromNest`.
///
/// GAP NYATA (lihat laporan migrasi untuk detail):
/// - `'start'`: Nest (`StartJobDto` + `TechnicianJobsService.start`) SELALU
///   mewajibkan `scannedBarcode` cocok dengan unit job ini, walau unit itu
///   tak punya `barcodeValue` sama sekali. RPC lama hanya mewajibkan scan
///   KALAU unit punya barcode. `job_detail_screen.dart._start` punya jalur
///   "job tanpa unit/barcode: mulai langsung tanpa scan" yang PATAH oleh gap
///   ini (Nest akan menolak 400 "Scan barcode unit diperlukan").
/// - `'complete'`: dipetakan ke `submit-for-review` (SATU-SATUNYA rute
///   Nest yang analog "teknisi menuntaskan job dari sisi teknisi") — TAPI
///   `submit-for-review` mewajibkan minimal 1 `JobFinding` (checklist temuan)
///   dengan foto sebelum+sesudah PER TEMUAN. App mobile ini tidak punya UI
///   temuan sama sekali (masih model flat job-level `job_photos`), jadi
///   endpoint ini akan SELALU menolak 400 "Minimal 1 temuan masalah harus
///   diisi..." untuk job manapun yang dikerjakan lewat UI saat ini. Ini
///   BUKAN bug migrasi — ini kesenjangan arsitektur nyata antara backend
///   (sudah pindah ke model checklist+review) dan app mobile (belum). Tidak
///   dipaksa-tambal di sini (menambal = menulis ulang businesslogic gate
///   submit-for-review di Flutter, yang dilarang) — diserahkan ke keputusan
///   produk: app mobile perlu UI temuan, atau `submit-for-review` perlu jalur
///   kompatibel model lama (di luar scope "endpoint kecil" sesi ini).
Future<void> callUpdateJobStatus(
  Map<String, dynamic> payload, {
  required Future<dynamic> Function(String path, {Object? body}) patch,
}) async {
  final jobId = payload['jobId'];
  final action = payload['action'];
  switch (action) {
    case 'start':
      await patch('/technician-jobs/$jobId/start',
          body: {'scannedBarcode': payload['scannedBarcode'] ?? ''});
      return;
    case 'complete':
    case 'submit_review':
      final notes = (payload['notes'] as String?)?.trim();
      if (notes != null && notes.isNotEmpty) {
        await patch('/technician-jobs/$jobId/notes', body: {'notes': notes});
      }
      await patch('/technician-jobs/$jobId/submit-for-review');
      return;
    case 'approve':
      await patch('/technician-jobs/$jobId/approve-complete');
      return;
    case 'send_back':
      await patch('/technician-jobs/$jobId/send-back',
          body: {'note': payload['note']});
      return;
    case 'cancel':
      await patch('/technician-jobs/$jobId/cancel');
      return;
    default:
      throw ArgumentError('Aksi tidak dikenal: $action');
  }
}

final updateJobStatusCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) => callUpdateJobStatus(payload, patch: _api.patch);
});
