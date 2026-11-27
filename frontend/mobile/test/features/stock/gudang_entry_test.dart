import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/features/stock/stock_adjust_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:epos_ac/features/stock/stok_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// Gudang tidak memegang nota: barang masuk lewat Terima Barang (tanpa harga),
// layar lama hanya untuk keluar/koreksi.

Future<void> _pump(WidgetTester tester, UserRole role, Widget screen) async {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      currentUserProvider.overrideWith(
          (ref) => Stream.value(AppUser(uid: 'u', email: 'e', displayName: 'U', role: role))),
      stockOverviewProvider.overrideWith((ref) => Future.value((
            products: const [StockRow(id: 'p1', kind: 'product', name: 'AC', stock: 4)],
            spareparts: const <StockRow>[],
            movements: const <MovementRow>[],
          ))),
    ],
    child: MaterialApp(home: screen),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('gudang: tombol utama Stok = Terima Barang, keluar/koreksi tetap ada', (tester) async {
    await _pump(tester, UserRole.gudang, const StokScreen());
    expect(find.widgetWithText(FloatingActionButton, 'Terima Barang'), findsOneWidget);
    expect(find.byKey(const Key('stok-adjust-action')), findsOneWidget);
  });

  testWidgets('admin: tombol utama tetap Mutasi Stok, Terima Barang tersedia', (tester) async {
    await _pump(tester, UserRole.admin, const StokScreen());
    expect(find.widgetWithText(FloatingActionButton, 'Mutasi Stok'), findsOneWidget);
    expect(find.byKey(const Key('stok-receive-action')), findsOneWidget);
  });

  testWidgets('gudang: layar mutasi tanpa arah Masuk dan tanpa kolom harga', (tester) async {
    await _pump(tester, UserRole.gudang, const StockAdjustScreen());
    expect(find.text(StockDirection.masuk.label), findsNothing);
    expect(find.text(StockDirection.keluar.label), findsOneWidget);
    expect(find.textContaining('Harga'), findsNothing);
  });

  testWidgets('admin: layar mutasi tetap punya arah Masuk', (tester) async {
    await _pump(tester, UserRole.admin, const StockAdjustScreen());
    expect(find.text(StockDirection.masuk.label), findsOneWidget);
  });
}
