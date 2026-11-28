import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/supabase/session_gate.dart';
import '../../data/models/installation_package.dart';
import '../../data/models/product.dart';
import '../../data/models/service_item.dart';
import '../../data/models/sparepart.dart';
import '../../data/repositories/crud_repository.dart';
import '../../data/repositories/master_data_repository.dart';
import '../../data/repositories/package_repository.dart';

/// Master data penuh lewat backend NestJS (baca + tulis).
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

/// PATCH sebagian: gudang membetulkan barang yang menunggu harga.
final fixPendingCallerProvider = Provider<Future<void> Function(String path, Map<String, dynamic> body)>(
  (ref) => (path, body) async {
    await const ApiClient().patch(path, body: body);
  },
);

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
