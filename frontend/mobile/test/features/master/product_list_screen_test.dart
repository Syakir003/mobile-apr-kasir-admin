import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/repositories/crud_repository.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/product/product_list_screen.dart';

import '../../support/fake_crud_repository.dart';

Product _product(String name, {int sellPrice = 200}) => Product(
      name: name,
      brand: 'Merek',
      type: 'T',
      pk: 1,
      inverter: false,
      buyPrice: 100,
      sellPrice: sellPrice,
      stock: 5,
      category: 'AC 1 PK',
    );

Widget _host(CrudRepository<Product> repo) {
  final router = GoRouter(
    initialLocation: '/products',
    routes: [
      GoRoute(path: '/products', builder: (_, __) => const ProductListScreen()),
    ],
  );
  return ProviderScope(
    overrides: [
      currentUserProvider.overrideWith((ref) => Stream.value(_signedInAdmin)),
      productRepositoryProvider.overrideWithValue(repo),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

/// Layar master ada di balik login, jadi test harus menyediakan sesi. Sejak
/// provider daftar digerbangi [streamWhenSignedIn] (lihat core/supabase/
/// session_gate.dart), tanpa sesi stream-nya sengaja tak pernah terbuka dan
/// daftar tetap kosong — persis seperti di aplikasi sungguhan.
const _signedInAdmin = AppUser(
  uid: 'u-admin',
  email: 'admin@eposac.local',
  displayName: 'Admin Ayub',
  role: UserRole.admin,
);

void main() {
  testWidgets('menampilkan item dari repository', (tester) async {
    final repo = FakeCrudRepository<Product>(seed: [
      MapEntry('a', _product('AC Sharp')),
      MapEntry('b', _product('AC Panasonic')),
    ]);
    addTearDown(repo.dispose);
    await tester.pumpWidget(_host(repo));
    await tester.pumpAndSettle();
    expect(find.text('AC Sharp'), findsOneWidget);
    expect(find.text('AC Panasonic'), findsOneWidget);
  });

  testWidgets('harga di subtitle memakai format rupiah yang sama dengan POS',
      (tester) async {
    final repo = FakeCrudRepository<Product>(seed: [
      MapEntry('a', _product('AC Sharp', sellPrice: 5500000)),
    ]);
    addTearDown(repo.dispose);
    await tester.pumpWidget(_host(repo));
    await tester.pumpAndSettle();
    expect(find.textContaining('Rp 5.500.000'), findsOneWidget);
    expect(find.textContaining('Rp 5500000'), findsNothing);
  });

  testWidgets('kolom cari memfilter berdasarkan nama', (tester) async {
    final repo = FakeCrudRepository<Product>(seed: [
      MapEntry('a', _product('AC Sharp')),
      MapEntry('b', _product('AC Panasonic')),
    ]);
    addTearDown(repo.dispose);
    await tester.pumpWidget(_host(repo));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('master-search')), 'sharp');
    await tester.pumpAndSettle();
    expect(find.text('AC Sharp'), findsOneWidget);
    expect(find.text('AC Panasonic'), findsNothing);
  });
}
