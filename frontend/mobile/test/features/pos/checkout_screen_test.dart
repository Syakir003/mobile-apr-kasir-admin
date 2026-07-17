import 'package:epos_ac/features/pos/cart_state.dart';
import 'package:epos_ac/features/pos/checkout_screen.dart';
import 'package:epos_ac/features/pos/pos_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// Notifier yang mem-build state awal dari [seed] — dipakai untuk
/// men-seed keranjang lewat override provider pada widget test
/// (`cartProvider.overrideWith(() => _SeededCartNotifier(seed))`).
class _SeededCartNotifier extends CartNotifier {
  _SeededCartNotifier(this.seed);

  final Cart seed;

  @override
  Cart build() => seed;
}

Widget _host({
  required Cart seed,
  required Future<({String invoiceId, String invoiceNumber})> Function(
          Map<String, dynamic>)
      caller,
}) {
  final router = GoRouter(
    initialLocation: '/pos/checkout',
    routes: [
      GoRoute(
        path: '/pos/checkout',
        builder: (_, __) => const CheckoutScreen(),
      ),
      GoRoute(
        path: '/transactions/:id',
        builder: (_, state) =>
            Scaffold(body: Text('detail-${state.pathParameters['id']}')),
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      cartProvider.overrideWith(() => _SeededCartNotifier(seed)),
      checkoutCallerProvider.overrideWithValue(caller),
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

void main() {
  testWidgets('submit kosong menampilkan error validasi, caller tidak terpanggil',
      (tester) async {
    _useTallViewport(tester);
    var called = false;
    await tester.pumpWidget(_host(
      seed: const Cart(),
      caller: (payload) async {
        called = true;
        return (invoiceId: 'inv1', invoiceNumber: 'INV-X');
      },
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(find.text('Wajib diisi'), findsWidgets);
    expect(called, isFalse);
  });

  testWidgets(
      'submit valid mengirim payload dengan HP ternormalisasi & installations benar, lalu navigasi ke detail',
      (tester) async {
    _useTallViewport(tester);
    Map<String, dynamic>? capturedPayload;
    const seed = Cart(
      lines: [
        CartLine(
          kind: CartItemKind.product,
          refId: 'p1',
          name: 'AC Split 1 PK',
          unit: 'unit',
          unitPrice: 3500000,
          qty: 2,
          withInstallation: true,
          roomLocation: 'Ruang tamu',
          technicianId: 't1',
        ),
        CartLine(
          kind: CartItemKind.service,
          refId: 's1',
          name: 'Cuci AC',
          unit: 'jasa',
          unitPrice: 75000,
          qty: 1,
        ),
      ],
    );

    await tester.pumpWidget(_host(
      seed: seed,
      caller: (payload) async {
        capturedPayload = payload;
        return (invoiceId: 'inv-123', invoiceNumber: 'INV-20260712-0001');
      },
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('name')), 'Budi Santoso');
    await tester.enterText(find.byKey(const Key('phone')), '0812-3456-7890');

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(capturedPayload, isNotNull);
    final payload = capturedPayload!;
    expect(payload['customer'], containsPair('phone', '+6281234567890'));
    expect(payload['customer'], containsPair('name', 'Budi Santoso'));
    expect(payload['items'], [
      {'kind': 'product', 'refId': 'p1', 'qty': 2},
      {'kind': 'service', 'refId': 's1', 'qty': 1},
    ]);
    final installations = payload['installations'] as List;
    expect(installations, hasLength(2));
    for (final inst in installations) {
      expect(inst, {
        'itemIndex': 0,
        'roomLocation': 'Ruang tamu',
        'technicianId': 't1',
      });
    }

    expect(find.text('detail-inv-123'), findsOneWidget);
  });
}
