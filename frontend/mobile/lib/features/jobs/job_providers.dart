import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/router/app_router.dart';
import '../../data/models/app_user.dart';
import '../../data/models/invoice.dart';
import '../../data/models/job_finding.dart';
import '../../data/models/material_request.dart';
import '../../data/models/service_order.dart';
import '../../data/models/technician_job.dart';
import '../../data/repositories/job_repository.dart';
import '../../core/utils/num_parse.dart';

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

/// Antrean teknisi (job aktif milik sendiri; memuat `hasBeforePhoto`). Dipakai dashboard.
final jobQueueProvider = FutureProvider.autoDispose<List<TechnicianJob>>(
  (ref) => ref.watch(jobRepositoryProvider).fetchQueue(),
);

/// Riwayat job selesai teknisi, per halaman (mulai 1).
final jobHistoryProvider = FutureProvider.autoDispose.family<JobHistoryPage, int>(
  (ref, page) => ref.watch(jobRepositoryProvider).fetchHistory(page),
);

/// Riwayat job untuk satu unit AC (terbaru dulu), lintas teknisi & order.
/// Semua peran boleh membaca (RLS `technician_jobs` = semua user login).
final unitJobHistoryProvider =
    FutureProvider.autoDispose.family<List<TechnicianJob>, String>(
  (ref, unitId) async =>
      (await ref.watch(jobRepositoryProvider).fetchUnitHistory(unitId)).jobs,
);

/// Riwayat satu unit AC, lengkap dengan ringkasan foto & material per entri.
///
/// Digabung dalam satu provider (bukan satu provider per job) supaya layar
/// riwayat cukup menunggu sekali dan tidak menembakkan dua query per baris.
// UnitHistory: lihat job_repository.dart.

final unitHistoryProvider =
    FutureProvider.autoDispose.family<UnitHistory, String>((ref, unitId) async {
  return ref.watch(jobRepositoryProvider).fetchUnitHistory(unitId);
});

/// Satu job by id (family). Null bila tidak ada.
final jobProvider = FutureProvider.autoDispose.family<TechnicianJob?, String>(
  (ref, id) => ref.watch(jobRepositoryProvider).fetchJobById(id),
);

/// Temuan masalah + foto bukti (sebelum/sesudah) satu job. Segarkan dengan
/// `ref.invalidate(jobFindingsProvider(jobId))` setelah tambah temuan/foto.
final jobFindingsProvider =
    FutureProvider.autoDispose.family<List<JobFinding>, String>(
  (ref, jobId) => ref.watch(jobRepositoryProvider).fetchFindings(jobId),
);

/// Signed URL sementara untuk menampilkan foto pada object [path].
final signedPhotoUrlProvider =
    FutureProvider.autoDispose.family<String, String>(
  (ref, path) => ref.watch(jobRepositoryProvider).signedPhotoUrl(path),
);

/// `PATCH /technician-jobs/:id/notes` — simpan diagnosa/catatan pengerjaan (job aktif).
Future<void> saveJobNotes(String jobId, String notes) =>
    _api.patch('/technician-jobs/$jobId/notes', body: {'notes': notes});

/// Kenapa Ajukan Selesai belum boleh (sama dengan gate `submitForReview` di server),
/// atau null bila sudah siap. Murni supaya bisa diuji.
String? submitBlockedReason(TechnicianJob job, List<JobFinding> findings) {
  if (findings.isEmpty) {
    return 'Tambah minimal 1 temuan dulu sebelum bisa mengajukan selesai.';
  }
  final missing = findings.where((f) => !f.hasBefore || !f.hasAfter).length;
  if (missing > 0) return '$missing temuan belum lengkap foto sebelum/sesudahnya.';
  if (!job.priced) {
    return job.findingsSentAt == null
        ? 'Harga jasa belum ditetapkan kasir/admin. Kirim temuan dan tunggu konfirmasi harganya.'
        : 'Temuan sudah terkirim. Menunggu kasir/admin menetapkan harga jasa.';
  }
  return null;
}

/// `POST /technician-jobs/:id/send-findings` — teknisi menandai temuan sudah diinput;
/// kasir/admin dinotifikasi untuk menetapkan harga jasa. Boleh dikirim ulang.
Future<void> sendFindings(String jobId) => _api.post('/technician-jobs/$jobId/send-findings');

/// `POST /technician-jobs/:jobId/findings` — tambah temuan (kategori diketik
/// bebas; kategori baru otomatis dibuat server).
Future<void> addFinding(String jobId, {required String categoryName, String? note}) =>
    _api.post('/technician-jobs/$jobId/findings', body: {
      'categoryName': categoryName,
      if (note != null && note.isNotEmpty) 'note': note,
    });

/// Sparepart aktif untuk pemilih pengajuan material (`GET /spareparts`, Nest).
/// Backend hanya menerima `kind: 'sparepart'`; `available` = stok dikurangi yang
/// sudah disetujui tapi belum dipakai.
final requestableSparepartsProvider =
    FutureProvider.autoDispose<List<RequestableSparepart>>((ref) async {
  final json = await _api.get('/spareparts') as List;
  return [
    for (final r in json)
      (
        id: '${(r as Map)['id']}',
        name: (r['name'] as String?) ?? '',
        unit: (r['unit'] as String?) ?? '',
        price: numFromNest(r['sellPrice'])?.toInt() ?? 0,
        available: (numFromNest(r['stock']) ?? 0) - (numFromNest(r['reserved']) ?? 0),
      ),
  ];
});

typedef RequestableSparepart = ({
  String id,
  String name,
  String unit,
  int price,
  num available,
});

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
  // `items` ({itemId, qtyUsed}) + `note` opsional; tanpa keduanya server menganggap terpakai penuh.
  return patch('/material-requests/${payload['requestId']}/mark-used',
      body: {
        if (payload['items'] != null) 'items': payload['items'],
        if (payload['note'] != null) 'note': payload['note'],
      });
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
  // POST /service-orders — payload sama persis dengan RPC create_service_order.
  return (payload) async {
    await _api.post('/service-orders', body: payload);
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

/// `order.invoice` dari GET /technician-jobs/:id -> [JobPaymentInfo]
/// (pengganti RPC job_payment_info). Murni supaya bisa diuji tanpa HTTP.
JobPaymentInfo jobPaymentInfoFromJobDetail(Map<String, dynamic> job) {
  final order = job['order'];
  final inv = order is Map ? order['invoice'] : null;
  if (inv is! Map) {
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
  final grand = numFromNest(inv['grandTotal'])?.toInt() ?? 0;
  final paid = numFromNest(inv['totalPaid'])?.toInt() ?? 0;
  return (
    hasInvoice: true,
    invoiceId: '${inv['id']}',
    number: '${inv['number']}',
    status: InvoiceStatus.fromValue(inv['status']),
    grandTotal: grand,
    totalPaid: paid,
    outstanding: grand - paid > 0 ? grand - paid : 0,
  );
}

final jobPaymentInfoProvider =
    FutureProvider.autoDispose.family<JobPaymentInfo, String>(
  (ref, jobId) async => jobPaymentInfoFromJobDetail(
    Map<String, dynamic>.from(await _api.get('/technician-jobs/$jobId') as Map),
  ),
);

/// Aksi status job lewat rute Nest terpisah per aksi (`start`, `submit-for-review`,
/// dst). Murni (tanpa Riverpod) supaya routing-nya bisa diuji tanpa mock HTTP.
/// Aturan bisnis (foto sebelum, barcode cocok, tiap temuan berfoto sebelum+sesudah)
/// dijaga server; pesan 400-nya ditampilkan apa adanya ke teknisi.
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
