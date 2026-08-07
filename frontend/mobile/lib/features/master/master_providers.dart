import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/session_gate.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../data/models/installation_package.dart';
import '../../data/models/product.dart';
import '../../data/models/service_item.dart';
import '../../data/models/sparepart.dart';
import '../../data/repositories/crud_repository.dart';
import '../../data/repositories/item_cost_repository.dart';
import '../../data/repositories/package_repository.dart';

final productRepositoryProvider = Provider<CrudRepository<Product>>((ref) {
  return SupabaseCrudRepository<Product>(
    ref.watch(supabaseProvider),
    'products',
    Product.fromMap,
    (p) => p.toMap(),
  );
});

final sparepartRepositoryProvider = Provider<CrudRepository<Sparepart>>((ref) {
  return SupabaseCrudRepository<Sparepart>(
    ref.watch(supabaseProvider),
    'spareparts',
    Sparepart.fromMap,
    (s) => s.toMap(),
  );
});

final serviceRepositoryProvider = Provider<CrudRepository<ServiceItem>>((ref) {
  return SupabaseCrudRepository<ServiceItem>(
    ref.watch(supabaseProvider),
    'services',
    ServiceItem.fromMap,
    (s) => s.toMap(),
  );
});

final packageRepositoryProvider =
    Provider<CrudRepository<InstallationPackage>>((ref) {
  return SupabasePackageRepository(ref.watch(supabaseProvider));
});

/// Harga modal (`item_costs`) — dipisah dari master data sejak migrasi 0021
/// agar hanya terbaca admin. Di-override fake pada test form.
final itemCostRepositoryProvider = Provider<ItemCostRepository>(
  (ref) => SupabaseItemCostRepository(ref.watch(supabaseProvider)),
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
