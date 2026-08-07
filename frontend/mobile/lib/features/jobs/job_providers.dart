import 'package:flutter_riverpod/flutter_riverpod.dart';

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

final jobRepositoryProvider = Provider<JobRepository>(
  (ref) => SupabaseJobRepository(ref.watch(supabaseProvider)),
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

/// RPC `add_job_photo` — catat metadata foto setelah biner terunggah ke Storage.
final addJobPhotoCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('add_job_photo', params: {'payload': payload});
  };
});

/// Pengajuan tambahan untuk satu job. Segarkan dengan
/// `ref.invalidate(jobRequestsProvider(jobId))` setelah submit/putusan.
final jobRequestsProvider =
    FutureProvider.autoDispose.family<List<MaterialRequest>, String>(
  (ref, jobId) => ref.watch(jobRepositoryProvider).fetchRequests(jobId),
);

/// RPC `submit_material_request` (teknisi mengajukan tambahan).
final submitRequestCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('submit_material_request', params: {'payload': payload});
  };
});

/// RPC `decide_material_request` (admin/kasir approve/revise/reject).
final decideRequestCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('decide_material_request', params: {'payload': payload});
  };
});

/// RPC `mark_material_used` (teknisi pemilik/admin menandai material dipakai →
/// stok baru dipotong di sini).
final markMaterialUsedCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('mark_material_used', params: {'payload': payload});
  };
});

/// Daftar order service (admin/kasir).
final ordersProvider =
    FutureProvider.autoDispose<List<ServiceOrder>>(
  (ref) => ref.watch(jobRepositoryProvider).fetchOrders(),
);

/// RPC `create_service_order` — admin/kasir menjadwalkan order manual
/// (service/maintenance/cuci) pada unit AC member yang sudah ada.
final createServiceOrderCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('create_service_order', params: {'payload': payload});
  };
});

/// RPC `assign_technician_job`. Dipisah agar mudah di-override fake di test.
final assignTechnicianCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('assign_technician_job', params: {'payload': payload});
  };
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

/// RPC `update_technician_job_status` (start/complete/cancel).
final updateJobStatusCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('update_technician_job_status', params: {'payload': payload});
  };
});
