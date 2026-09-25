import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/supabase/session_gate.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../data/models/installation_package.dart';
import '../../data/models/product.dart';
import '../../data/models/service_item.dart';
import '../../data/models/sparepart.dart';
import '../../data/repositories/crud_repository.dart';
import '../../data/repositories/item_cost_repository.dart';
import '../../data/repositories/master_data_repository.dart';
import '../../data/repositories/package_repository.dart';

/// Sudah dipindah ke backend NestJS (`Nest*Repository`) sebagai repository
/// rujukan migrasi Flutter -> Nest, sama pola seperti [itemCostRepositoryProvider].
/// `watchAll()` tetap lewat Supabase Realtime di dalam masing-masing kelas —
/// hanya `create`/`update` yang pindah. [SupabaseCrudRepository] /
/// [SupabasePackageRepository] dibiarkan ada di file sumbernya untuk rollback
/// cepat bila diperlukan.
final productRepositoryProvider = Provider<CrudRepository<Product>>((ref) {
  return NestProductRepository(ref.watch(supabaseProvider), const ApiClient());
});

final sparepartRepositoryProvider = Provider<CrudRepository<Sparepart>>((ref) {
  return NestSparepartRepository(ref.watch(supabaseProvider), const ApiClient());
});

final serviceRepositoryProvider = Provider<CrudRepository<ServiceItem>>((ref) {
  return NestServiceRepository(ref.watch(supabaseProvider), const ApiClient());
});

final packageRepositoryProvider =
    Provider<CrudRepository<InstallationPackage>>((ref) {
  return NestPackageRepository(ref.watch(supabaseProvider), const ApiClient());
});

/// Harga modal (`item_costs`) — dipisah dari master data sejak migrasi 0021
/// agar hanya terbaca admin. Di-override fake pada test form.
final itemCostRepositoryProvider = Provider<ItemCostRepository>(
  (ref) => NestItemCostRepository(const ApiClient()),
);

/// Harga modal satu barang. Key: `('product'|'sparepart', refId)`.
/// Mengembalikan 0 bila barang baru (refId kosong) atau belum pernah diisi.
final itemCostProvider =
    FutureProvider.autoDispose.family<int, (CostKind, String)>((ref, key) {
  final (kind, refId) = key;
  if (refId.isEmpty) return Future.value(0);
  return ref.watch(itemCostRepositoryProvider).fetch(kind, refId);
});

final productListProvider = StreamProvider<List<Product>>(
  (ref) => streamWhenSignedIn(
      ref, () => ref.watch(productRepositoryProvider).watchAll()),
);

final sparepartListProvider = StreamProvider<List<Sparepart>>(
  (ref) => streamWhenSignedIn(
      ref, () => ref.watch(sparepartRepositoryProvider).watchAll()),
);

final serviceListProvider = StreamProvider<List<ServiceItem>>(
  (ref) => streamWhenSignedIn(
      ref, () => ref.watch(serviceRepositoryProvider).watchAll()),
);

final packageListProvider = StreamProvider<List<InstallationPackage>>(
  (ref) => streamWhenSignedIn(
      ref, () => ref.watch(packageRepositoryProvider).watchAll()),
);
