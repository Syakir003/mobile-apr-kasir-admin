import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/installation_package.dart';
import '../../data/models/product.dart';
import '../../data/models/service_item.dart';
import '../../data/models/sparepart.dart';
import '../../data/repositories/crud_repository.dart';

final firestoreProvider = Provider<FirebaseFirestore>(
  (ref) => FirebaseFirestore.instance,
);

final productRepositoryProvider = Provider<CrudRepository<Product>>((ref) {
  return FirestoreCrudRepository<Product>(
    ref.watch(firestoreProvider),
    'products',
    Product.fromMap,
    (p) => p.toMap(),
  );
});

final sparepartRepositoryProvider = Provider<CrudRepository<Sparepart>>((ref) {
  return FirestoreCrudRepository<Sparepart>(
    ref.watch(firestoreProvider),
    'spareparts',
    Sparepart.fromMap,
    (s) => s.toMap(),
  );
});

final serviceRepositoryProvider = Provider<CrudRepository<ServiceItem>>((ref) {
  return FirestoreCrudRepository<ServiceItem>(
    ref.watch(firestoreProvider),
    'services',
    ServiceItem.fromMap,
    (s) => s.toMap(),
  );
});

final packageRepositoryProvider =
    Provider<CrudRepository<InstallationPackage>>((ref) {
  return FirestoreCrudRepository<InstallationPackage>(
    ref.watch(firestoreProvider),
    'installation_packages',
    InstallationPackage.fromMap,
    (p) => p.toMap(),
  );
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
