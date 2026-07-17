import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/router/app_router.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../data/models/app_user.dart';
import '../../data/models/job_photo.dart';
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

/// Daftar order service (admin/kasir).
final ordersProvider =
    FutureProvider.autoDispose<List<ServiceOrder>>(
  (ref) => ref.watch(jobRepositoryProvider).fetchOrders(),
);

/// RPC `assign_technician_job`. Dipisah agar mudah di-override fake di test.
final assignTechnicianCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('assign_technician_job', params: {'payload': payload});
  };
});

/// RPC `update_technician_job_status` (start/complete/cancel).
final updateJobStatusCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('update_technician_job_status', params: {'payload': payload});
  };
});
