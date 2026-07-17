import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/models/service_item.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/pos/pos_providers.dart';
import 'package:epos_ac/features/pos/pos_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../../support/fake_crud_repository.dart';

Widget _host({
  required FakeCrudRepository<Product> products,
  required FakeCrudRepository<Sparepart> spareparts,
  required FakeCrudRepository<ServiceItem> services,
}) {
  final router = GoRouter(
    initialLocation: '/pos',
    routes: [
      GoRoute(
        path: '/pos',
        builder: (_, __) => const PosScreen(),
        routes: [
          GoRoute(
            path: 'checkout',
            builder: (_, __) => const Scaffold(body: Text('checkout')),
          ),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      productRepositoryProvider.overrideWithValue(products),
      sparepartRepositoryProvider.overrideWithValue(spareparts),
      serviceRepositoryProvider.overrideWithValue(services),
      techniciansProvider.overrideWith((ref) => Stream.value(const [])),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

void _useTallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

const _product = Product(
  id: 'p1',
  name: 'AC Split 1 PK',
  brand: 'Daikin',
  type: 'FTV25',
  pk: 1,
  inverter: false,
  buyPrice: 3000000,
  sellPrice: 3500000,
  stock: 5,
  category: 'AC 1 PK',
);

void main() {
  testWidgets('buka picker & tap produk menambah baris dengan total benar',
      (tester) async {
    _useTallViewport(tester);
    final products = FakeCrudRepository<Product>(
      seed: [const MapEntry('p1', _product)],
    );
    final spareparts = FakeCrudRepository<Sparepart>();
    final services = FakeCrudRepository<ServiceItem>();
    addTearDown(products.dispose);
    addTearDown(spareparts.dispose);
    addTearDown(services.dispose);

    await tester.pumpWidget(
      _host(products: products, spareparts: spareparts, services: services),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('add-item')));
    await tester.pumpAndSettle();

    expect(find.text('AC Split 1 PK'), findsOneWidget);
    await tester.tap(find.text('AC Split 1 PK'));
    await tester.pumpAndSettle();

    // Bottom sheet tertutup, baris muncul di keranjang.
    expect(find.text('AC Split 1 PK'), findsOneWidget);
    expect(find.text('Rp 3.500.000'), findsWidgets);
    // Subtotal = total (tanpa diskon/pajak/transport) = 3.500.000.
    expect(find.text('Rp 3.500.000'), findsAtLeastNWidgets(2));

    final toCheckout = find.byKey(const Key('to-checkout'));
    expect(tester.widget<FilledButton>(toCheckout).onPressed, isNotNull);
  });

  testWidgets('toggle pasang menampilkan field lokasi ruangan',
      (tester) async {
    _useTallViewport(tester);
    final products = FakeCrudRepository<Product>(
      seed: [const MapEntry('p1', _product)],
    );
    final spareparts = FakeCrudRepository<Sparepart>();
    final services = FakeCrudRepository<ServiceItem>();
    addTearDown(products.dispose);
    addTearDown(spareparts.dispose);
    addTearDown(services.dispose);

    await tester.pumpWidget(
      _host(products: products, spareparts: spareparts, services: services),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('add-item')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AC Split 1 PK'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('room-location-0')), findsNothing);

    await tester.tap(find.byKey(const Key('install-switch-0')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('room-location-0')), findsOneWidget);
    expect(find.byKey(const Key('technician-0')), findsOneWidget);
  });
}
