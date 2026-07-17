import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../data/models/installation_package.dart';
import '../../data/models/product.dart';
import '../../data/models/service_item.dart';
import '../../data/models/sparepart.dart';
import '../../data/repositories/crud_repository.dart';
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

final productListProvider = StreamProvider<List<Product>>(
  (ref) => ref.watch(productRepositoryProvider).watchAll(),
);

final sparepartListProvider = StreamProvider<List<Sparepart>>(
  (ref) => ref.watch(sparepartRepositoryProvider).watchAll(),
);

final serviceListProvider = StreamProvider<List<ServiceItem>>(
  (ref) => ref.watch(serviceRepositoryProvider).watchAll(),
);

final packageListProvider = StreamProvider<List<InstallationPackage>>(
  (ref) => ref.watch(packageRepositoryProvider).watchAll(),
);
