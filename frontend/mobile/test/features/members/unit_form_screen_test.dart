import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/features/members/member_providers.dart';
import 'package:epos_ac/features/members/unit_form_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../../support/fake_ac_unit_repository.dart';

Widget _host(
  FakeAcUnitRepository repo,
  Future<String> Function(String unitId) generator,
) {
  final router = GoRouter(
    initialLocation: '/members/m1/units/new',
    routes: [
      GoRoute(
        path: '/members/:id',
        builder: (_, __) => const Scaffold(body: Text('detail')),
        routes: [
          GoRoute(
            path: 'units/new',
            builder: (_, state) =>
                UnitFormScreen(memberId: state.pathParameters['id']!),
          ),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      acUnitRepositoryProvider.overrideWithValue(repo),
      acUnitBarcodeGeneratorProvider.overrideWithValue(generator),
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
  testWidgets('submit kosong menampilkan error validasi', (tester) async {
    _useTallViewport(tester);
    final repo = FakeAcUnitRepository();
    addTearDown(repo.dispose);
    await tester.pumpWidget(_host(repo, (id) async => 'X'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.text('Wajib diisi'), findsWidgets);
    expect(repo.created, isEmpty);
  });

  testWidgets('submit valid membuat unit lalu generate barcode',
      (tester) async {
    _useTallViewport(tester);
    final repo = FakeAcUnitRepository();
    addTearDown(repo.dispose);
    final generatedFor = <String>[];
    await tester.pumpWidget(_host(repo, (id) async {
      generatedFor.add(id);
      return 'ACUNIT-20260706-0001';
    }));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('brand')), 'Daikin');
    await tester.enterText(find.byKey(const Key('model')), 'FTV-25');
    await tester.enterText(
        find.byKey(const Key('roomLocation')), 'Kamar utama');

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(repo.created, hasLength(1));
    final created = repo.created.single;
    expect(created.memberId, 'm1');
    expect(created.brand, 'Daikin');
    expect(created.model, 'FTV-25');
    expect(created.pk, 0.5);
    expect(created.roomLocation, 'Kamar utama');
    expect(created.barcodeValue, '');
    expect(created.status, AcUnitStatus.menungguPemasangan);

    expect(generatedFor, ['fake-unit-0']);
    expect(find.textContaining('ACUNIT-20260706-0001'), findsOneWidget);
    expect(find.text('detail'), findsOneWidget);
  });

  testWidgets('generate barcode gagal: unit tetap tersimpan', (tester) async {
    _useTallViewport(tester);
    final repo = FakeAcUnitRepository();
    addTearDown(repo.dispose);
    await tester.pumpWidget(
      _host(repo, (id) async => throw Exception('offline')),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('brand')), 'Sharp');
    await tester.enterText(find.byKey(const Key('model')), 'AH-X9');

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(repo.created, hasLength(1));
    expect(find.textContaining('barcode gagal'), findsOneWidget);
    expect(find.text('detail'), findsOneWidget);
  });
}
