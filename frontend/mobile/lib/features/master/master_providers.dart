import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/supabase/session_gate.dart';
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
/// Master data penuh lewat Nest (baca + tulis).
final productRepositoryProvider = Provider<CrudRepository<Product>>((ref) {
  return const NestProductRepository(ApiClient());
});

final sparepartRepositoryProvider = Provider<CrudRepository<Sparepart>>((ref) {
  return const NestSparepartRepository(ApiClient());
});

final serviceRepositoryProvider = Provider<CrudRepository<ServiceItem>>((ref) {
  return const NestServiceRepository(ApiClient());
});

final packageRepositoryProvider =
    Provider<CrudRepository<InstallationPackage>>((ref) {
  return const NestPackageRepository(ApiClient());
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
