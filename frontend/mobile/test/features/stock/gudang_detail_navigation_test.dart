import 'dart:async';

import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/sparepart/sparepart_list_screen.dart';
import 'package:epos_ac/features/stock/stock_detail_screen.dart';
import 'package:epos_ac/features/stock/stock_opname_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// Tombol kembali pada alur gudang, memakai router asli aplikasi.

// Ada animasi yang tidak pernah diam; pump beberapa kali saja.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  tester.takeException(); // data layar lain memang tidak bisa dimuat di tes
}

void main() {
  testWidgets('daftar -> detail -> koreksi stok, kembali setahap demi setahap', (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final container = ProviderContainer(overrides: [
      currentUserProvider.overrideWith(
          (ref) => Stream.value(const AppUser(uid: 'g', email: 'e', displayName: 'G', role: UserRole.gudang))),
      sparepartListProvider.overrideWith((ref) => Stream.value([
            Sparepart.fromMap('s1', {'name': 'Kapasitor', 'active': true, 'stock': '7', 'unit': 'pcs'}),
          ])),
      stockDetailProvider.overrideWith((ref, k) async => stockDetailFrom(k, const [
            {'id': 's1', 'name': 'Kapasitor', 'stock': '7', 'unit': 'pcs', 'active': true},
          ])),
      stockBatchesProvider.overrideWith((ref, k) async => <StockBatch>[]),
      stockOverviewProvider.overrideWith((ref) async => (
            products: <StockRow>[],
            spareparts: [const StockRow(id: 's1', kind: 'sparepart', name: 'Kapasitor', stock: 7)],
            movements: <MovementRow>[],
          )),
    ]);
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(theme: AppTheme.light(), routerConfig: router),
    ));
    await _settle(tester);

    router.go('/spareparts');
    await _settle(tester);
    await tester.tap(find.text('Kapasitor'));
    await _settle(tester);
    expect(find.byType(StockDetailScreen), findsOneWidget);

    await tester.tap(find.byKey(const Key('detail-fix-stock')));
    await _settle(tester);
    expect(find.byType(StockOpnameScreen), findsOneWidget);

    unawaited(tester.binding.handlePopRoute()); // tombol kembali HP
    await _settle(tester);
    expect(find.byType(StockOpnameScreen), findsNothing);
    expect(find.byType(StockDetailScreen), findsOneWidget);

    unawaited(tester.binding.handlePopRoute());
    await _settle(tester);
    expect(find.byType(StockDetailScreen), findsNothing);
    expect(find.byType(SparepartListScreen), findsOneWidget);
  });
}
