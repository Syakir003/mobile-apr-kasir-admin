import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/product/product_form_screen.dart';

import '../../support/fake_crud_repository.dart';

Widget _host(FakeCrudRepository<Product> repo) {
  final router = GoRouter(
    initialLocation: '/products/new',
    routes: [
      GoRoute(
        path: '/products',
        builder: (_, __) => const Scaffold(body: Text('list')),
        routes: [
          GoRoute(path: 'new', builder: (_, __) => const ProductFormScreen()),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [productRepositoryProvider.overrideWithValue(repo)],
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  testWidgets('submit kosong menampilkan error validasi', (tester) async {
    final repo = FakeCrudRepository<Product>();
    addTearDown(repo.dispose);
    await tester.pumpWidget(_host(repo));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.text('Wajib diisi'), findsWidgets);
    expect(repo.created, isEmpty);
  });

  testWidgets('submit valid memanggil create dengan nilai benar',
      (tester) async {
    final repo = FakeCrudRepository<Product>();
    addTearDown(repo.dispose);
    await tester.pumpWidget(_host(repo));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('name')), 'AC Baru');
    await tester.enterText(find.byKey(const Key('brand')), 'Daikin');
    await tester.enterText(find.byKey(const Key('type')), 'FTV');
    await tester.enterText(find.byKey(const Key('pk')), '1.5');
    await tester.enterText(find.byKey(const Key('buyPrice')), '3000000');
    await tester.enterText(find.byKey(const Key('sellPrice')), '3500000');
    await tester.enterText(find.byKey(const Key('stock')), '7');

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(repo.created, hasLength(1));
    final created = repo.created.single;
    expect(created.name, 'AC Baru');
    expect(created.brand, 'Daikin');
    expect(created.type, 'FTV');
    expect(created.pk, 1.5);
    expect(created.buyPrice, 3000000);
    expect(created.sellPrice, 3500000);
    expect(created.stock, 7);
    expect(created.category, kProductCategories.first);
    expect(created.active, isTrue);
    expect(created.id, '');
  });
}
