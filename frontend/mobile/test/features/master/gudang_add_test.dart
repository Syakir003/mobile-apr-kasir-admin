import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/router/redirect.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/product/product_form_screen.dart';
import 'package:epos_ac/features/master/sparepart/sparepart_form_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../../support/fake_crud_repository.dart';

// Gudang menambah barang yang langsung bisa dijual: harga jual diisi, harga
// modal tidak ada, dan tidak ada panggilan khusus admin (PATCH).

const _gudang = AppUser(uid: 'g', email: 'e', displayName: 'G', role: UserRole.gudang);

Future<void> _pump(WidgetTester tester, Widget screen, List<Override> overrides) async {
  tester.view.physicalSize = const Size(800, 2600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final router = GoRouter(initialLocation: '/x/new', routes: [
    GoRoute(path: '/products', builder: (_, __) => const Scaffold(body: Text('list'))),
    GoRoute(path: '/spareparts', builder: (_, __) => const Scaffold(body: Text('list'))),
    GoRoute(path: '/x/new', builder: (_, __) => screen),
  ]);
  await tester.pumpWidget(ProviderScope(
    overrides: [currentUserProvider.overrideWith((ref) => Stream.value(_gudang)), ...overrides],
    child: MaterialApp.router(routerConfig: router),
  ));
  await tester.pumpAndSettle();
}

Future<void> _type(WidgetTester tester, String key, String text) =>
    tester.enterText(find.byKey(Key(key)), text);

void main() {
  test('gudang boleh membuka form tambah produk & sparepart, bukan edit', () {
    String? redirect(String loc) =>
        computeRedirect(user: _gudang, role: UserRole.gudang, loading: false, location: loc);
    expect(redirect('/products/new'), isNull);
    expect(redirect('/spareparts/new'), isNull);
    expect(redirect('/products/p1/edit'), '/');
  });

  testWidgets('produk: tanpa harga modal, stok awal dikirim tanpa buyPrice', (tester) async {
    final repo = FakeCrudRepository<Product>();
    addTearDown(repo.dispose);
    final sent = <Map<String, dynamic>>[];
    await _pump(tester, const ProductFormScreen(), [
      productRepositoryProvider.overrideWithValue(repo),
      stockInCallerProvider.overrideWithValue((p) async {
        sent.add(p);
        return (needsConfirm: false, warnings: const <String>[]);
      }),
    ]);
    expect(find.byKey(const Key('buyPrice')), findsNothing);
    expect(find.byKey(const Key('active')), findsNothing);
    await _type(tester, 'name', 'AC Baru');
    await _type(tester, 'brand', 'Daikin');
    await _type(tester, 'type', 'FTV');
    await _type(tester, 'pk', '1');
    await _type(tester, 'sellPrice', '3500000');
    await _type(tester, 'description', 'hemat');
    await _type(tester, 'stock', '2');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(repo.created.single.sellPrice, 3500000);
    expect(repo.updated, isEmpty); // PATCH admin saja
    expect(sent.single.containsKey('buyPrice'), isFalse);
    expect(sent.single['qty'], 2);
    expect(find.text('Produk tersimpan.'), findsOneWidget);
  });

  testWidgets('sparepart: harga jual boleh kosong, tersimpan menunggu harga', (tester) async {
    final repo = FakeCrudRepository<Sparepart>();
    addTearDown(repo.dispose);
    final sent = <Map<String, dynamic>>[];
    await _pump(tester, const SparepartFormScreen(), [
      sparepartRepositoryProvider.overrideWithValue(repo),
      stockInCallerProvider.overrideWithValue((p) async {
        sent.add(p);
        return (needsConfirm: false, warnings: const <String>[]);
      }),
    ]);
    expect(find.byKey(const Key('buyPrice')), findsNothing);
    await _type(tester, 'name', 'Freon');
    await _type(tester, 'sku', 'SP-9');
    await _type(tester, 'minStock', '1');
    await _type(tester, 'stock', '5');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(repo.created.single.sellPrice, 0);
    expect(sent.single.containsKey('buyPrice'), isFalse);
    expect(find.textContaining('menunggu harga'), findsOneWidget);
  });
}
