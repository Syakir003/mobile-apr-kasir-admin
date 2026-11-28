import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/data/repositories/master_data_repository.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/sparepart/sparepart_form_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../../support/fake_crud_repository.dart';

// Form sparepart di HP sama dengan web: "dijual bagaimana?", tabung/roll, harga
// per kg dan per tabung, stok awal dihitung per tabung atau per kg.

typedef _Run = ({FakeCrudRepository<Sparepart> repo, List<Map<String, dynamic>> stockIns});

Future<_Run> _pump(WidgetTester tester, UserRole role) async {
  tester.view.physicalSize = const Size(800, 3600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final repo = FakeCrudRepository<Sparepart>();
  addTearDown(repo.dispose);
  final stockIns = <Map<String, dynamic>>[];
  final router = GoRouter(initialLocation: '/new', routes: [
    GoRoute(path: '/spareparts', builder: (_, __) => const Scaffold(body: Text('list'))),
    GoRoute(path: '/new', builder: (_, __) => const SparepartFormScreen()),
  ]);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      currentUserProvider.overrideWith(
          (ref) => Stream.value(AppUser(uid: 'u', email: 'e', displayName: 'U', role: role))),
      sparepartRepositoryProvider.overrideWithValue(repo),
      stockInCallerProvider.overrideWithValue((p) async {
        stockIns.add(p);
        return (needsConfirm: false, warnings: const <String>[]);
      }),
    ],
    child: MaterialApp.router(routerConfig: router),
  ));
  await tester.pumpAndSettle();
  return (repo: repo, stockIns: stockIns);
}

Future<void> _tap(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.tap(f);
  await tester.pumpAndSettle();
}

Future<void> _type(WidgetTester tester, String key, String text) async {
  await tester.enterText(find.byKey(Key(key)), text);
  await tester.pumpAndSettle();
}

Future<void> _choose(WidgetTester tester, String key, String option) async {
  await _tap(tester, find.byKey(Key(key)));
  await tester.tap(find.text(option).last);
  await tester.pumpAndSettle();
}

/// Freon: 1 tabung = 10 kg.
Future<void> _freon(WidgetTester tester, String mode) async {
  await _type(tester, 'name', 'Freon R32');
  await _tap(tester, find.byKey(Key('mode-$mode')));
  await _tap(tester, find.byKey(const Key('packUnit-tabung')));
  await _type(tester, 'packSize', '10');
  await _tap(tester, find.byKey(const Key('unit-kg')));
}

Future<void> _save(WidgetTester tester) => _tap(tester, find.byKey(const Key('submit')));

void main() {
  testWidgets('gudang, per tabung: label ikut satuan, tabung utuh jadi gulungan tanpa harga modal', (tester) async {
    final run = await _pump(tester, UserRole.gudang);
    await _freon(tester, 'gabungan');
    expect(find.textContaining('1 tabung berisi 10 kg'), findsOneWidget);
    // Gudang tidak punya isian harga sama sekali.
    expect(find.byKey(const Key('sellPrice')), findsNothing);
    expect(find.byKey(const Key('sellPricePack')), findsNothing);
    await _type(tester, 'stock', '4');
    expect(find.text('4 tabung = 40 kg'), findsOneWidget);
    await _save(tester);

    final created = run.repo.created.single;
    expect(created.trackingMode, 'gabungan');
    expect(created.packUnit, 'tabung');
    expect(created.packSize, 10);
    expect(created.sellPricePack, 0);
    expect(run.stockIns.single['rolls'], List.filled(4, {'length': 10}));
    expect(run.stockIns.single.containsKey('buyPrice'), isFalse);
  });

  testWidgets('dihitung per kg: sisa jadi tabung tidak penuh', (tester) async {
    final run = await _pump(tester, UserRole.gudang);
    await _freon(tester, 'gabungan');
    await _tap(tester, find.byKey(const Key('stockIn-unit')));
    await _type(tester, 'stock', '25');
    expect(find.textContaining('dicatat 2 tabung penuh + 1 tabung terbuka 5 kg'), findsOneWidget);
    await _save(tester);
    expect(run.stockIns.single['rolls'], [
      {'length': 10},
      {'length': 10},
      {'length': 5},
    ]);
    expect(find.textContaining('menunggu harga'), findsOneWidget);
  });

  testWidgets('admin, cukup total: harga modal per tabung dibagi per kg', (tester) async {
    final run = await _pump(tester, UserRole.admin);
    await _freon(tester, 'konversi');
    expect(find.textContaining('Harga jual per kg'), findsOneWidget);
    expect(find.textContaining('Harga jual 1 tabung utuh'), findsOneWidget);
    await _type(tester, 'sellPrice', '90000');
    await _type(tester, 'sellPricePack', '800000');
    await _type(tester, 'stock', '2');
    await _type(tester, 'buyPrice', '500000');
    expect(find.text('= Rp 50.000 per kg'), findsOneWidget);
    await _save(tester);
    expect(run.stockIns.single['qty'], 20);
    expect(run.stockIns.single['buyPrice'], 50000);
  });

  testWidgets('hanya diecer per roll: tanpa stok awal', (tester) async {
    final run = await _pump(tester, UserRole.gudang);
    await _type(tester, 'name', 'Kabel');
    await _tap(tester, find.byKey(const Key('mode-gulungan')));
    await _tap(tester, find.byKey(const Key('unit-meter')));
    expect(find.byKey(const Key('stock')), findsNothing);
    await _save(tester);
    expect(run.repo.created.single.trackingMode, 'gulungan');
    expect(run.stockIns, isEmpty);
  });

  testWidgets('isi per tabung belum diisi: tidak tersimpan', (tester) async {
    final run = await _pump(tester, UserRole.gudang);
    await _type(tester, 'name', 'Freon');
    await _tap(tester, find.byKey(const Key('mode-gabungan')));
    await _save(tester);
    expect(run.repo.created, isEmpty);
  });

  testWidgets('template cepat mengisi nama, jenis, satuan & isi; tanpa SKU tetap tersimpan', (tester) async {
    final run = await _pump(tester, UserRole.gudang);
    await _choose(tester, 'template', 'Freon R32');
    expect(find.text('1 tabung berisi 10 kg'), findsOneWidget);
    expect(find.byKey(const Key('minStock')), findsNothing);
    await _save(tester);

    final created = run.repo.created.single;
    expect(created.name, 'Freon R32');
    expect(created.category, 'Freon & Gas');
    expect(created.trackingMode, 'gabungan');
    expect(created.unit, 'kg');
    expect(created.packSize, 10);
    expect(sparepartCreateBody(created).containsKey('sku'), isFalse);
  });

  testWidgets('muat di layar HP selebar 360 untuk semua jenis', (tester) async {
    await _pump(tester, UserRole.gudang);
    tester.view.physicalSize = const Size(360, 4000);
    await tester.pumpAndSettle();
    await _choose(tester, 'template', 'Kabel NYYHY 4x1,5 (kontrol indoor-outdoor)');
    await _type(tester, 'stock', '12,5');
    for (final mode in ['biasa', 'gabungan', 'konversi', 'gulungan']) {
      await _tap(tester, find.byKey(Key('mode-$mode')));
    }
    expect(tester.takeException(), isNull);
  });

  test('muatan create: jenis & kemasan ikut, biasa tidak berubah', () {
    const pack = Sparepart(
        name: 'F', sku: '', category: 'sparepart', unit: 'kg', buyPrice: 0, sellPrice: 90000,
        stock: 0, minStock: 0, trackingMode: 'gabungan', packUnit: 'tabung', packSize: 10,
        sellPricePack: 800000);
    final body = sparepartCreateBody(pack);
    expect(body['trackingMode'], 'gabungan');
    expect(body['packUnit'], 'tabung');
    expect(body['packSize'], 10);
    expect(body['sellPricePack'], 800000);
    const biasa = Sparepart(
        name: 'B', sku: '', category: 'sparepart', unit: 'pcs', buyPrice: 0, sellPrice: 1,
        stock: 0, minStock: 0);
    expect(sparepartCreateBody(biasa).containsKey('trackingMode'), isFalse);
  });
}
