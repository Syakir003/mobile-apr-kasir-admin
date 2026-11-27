import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/sparepart/sparepart_form_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';

import '../../support/fake_crud_repository.dart';

const _existing = Sparepart(
  id: 's1',
  name: 'Freon Lama',
  sku: 'SP-1',
  category: 'sparepart',
  unit: 'kg',
  buyPrice: 0,
  sellPrice: 90000,
  stock: 4,
  minStock: 1,
  active: true,
);

Future<FakeCrudRepository<Sparepart>> _pump(
  WidgetTester tester, {
  Sparepart? initial,
  List<Map<String, dynamic>>? stockIns,
  bool stockInFails = false,
}) async {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final repo = FakeCrudRepository<Sparepart>();
  addTearDown(repo.dispose);
  final router = GoRouter(
    initialLocation: '/spareparts/new',
    routes: [
      GoRoute(
        path: '/spareparts',
        builder: (_, __) => const Scaffold(body: Text('list')),
        routes: [
          GoRoute(path: 'new', builder: (_, __) => SparepartFormScreen(initial: initial)),
        ],
      ),
    ],
  );
  await tester.pumpWidget(ProviderScope(
    overrides: [
      sparepartRepositoryProvider.overrideWithValue(repo),
      stockInCallerProvider.overrideWithValue((payload) async {
        if (stockInFails) throw Exception('server menolak');
        stockIns?.add(payload);
        return (needsConfirm: false, warnings: const <String>[]);
      }),
    ],
    child: MaterialApp.router(routerConfig: router),
  ));
  await tester.pumpAndSettle();
  return repo;
}

Future<void> _type(WidgetTester tester, String key, String text) =>
    tester.enterText(find.byKey(Key(key)), text);

Future<void> _fillRequired(WidgetTester tester) async {
  await _type(tester, 'name', 'Freon R32');
  await _type(tester, 'sku', 'SP-2');
  await _type(tester, 'sellPrice', '90000');
  await _type(tester, 'minStock', '2');
}

Future<void> _submit(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('submit')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('tanpa stok awal: sparepart dibuat, tidak ada barang masuk', (tester) async {
    final stockIns = <Map<String, dynamic>>[];
    final repo = await _pump(tester, stockIns: stockIns);
    await _fillRequired(tester);
    await _submit(tester);

    expect(repo.created.single.name, 'Freon R32');
    expect(repo.created.single.sellPrice, 90000);
    expect(stockIns, isEmpty);
    expect(find.text('list'), findsOneWidget);
    expect(find.text('Sparepart tersimpan.'), findsOneWidget);
  });

  testWidgets('stok awal berkoma dicatat sebagai barang masuk dengan harga modal', (tester) async {
    final stockIns = <Map<String, dynamic>>[];
    await _pump(tester, stockIns: stockIns);
    await _fillRequired(tester);
    await _type(tester, 'stock', '2,5');
    await _type(tester, 'buyPrice', '50000');
    await _submit(tester);

    expect(stockIns.single, {
      'kind': 'sparepart',
      'refId': 'fake-0',
      'qty': 2.5,
      'buyPrice': 50000,
      'note': 'Stok awal',
    });
    expect(find.text('list'), findsOneWidget);
  });

  testWidgets('stok awal diisi tapi harga modal kosong: ditolak', (tester) async {
    final repo = await _pump(tester);
    await _fillRequired(tester);
    await _type(tester, 'stock', '2');
    await _submit(tester);

    expect(repo.created, isEmpty);
    expect(find.text('Wajib diisi'), findsOneWidget);
  });

  testWidgets('barang masuk gagal: sparepart tidak dibuat dua kali', (tester) async {
    final repo = await _pump(tester, stockInFails: true);
    await _fillRequired(tester);
    await _type(tester, 'stock', '2');
    await _type(tester, 'buyPrice', '50000');
    await _submit(tester);

    expect(repo.created, hasLength(1));
    expect(find.text('list'), findsOneWidget);
    expect(find.textContaining('Sparepart tersimpan, tetapi'), findsOneWidget);
  });

  testWidgets('sparepart baru yang dimatikan: status nonaktif dikirim lewat update', (tester) async {
    final repo = await _pump(tester);
    await _fillRequired(tester);
    await tester.tap(find.byKey(const Key('active')));
    await tester.pumpAndSettle();
    await _submit(tester);

    expect(repo.updated.single.key, 'fake-0');
    expect(repo.updated.single.value.active, isFalse);
  });

  testWidgets('edit: tidak ada isian stok & modal, simpan berhasil', (tester) async {
    final stockIns = <Map<String, dynamic>>[];
    final repo = await _pump(tester, initial: _existing, stockIns: stockIns);

    expect(find.byKey(const Key('stock')), findsNothing);
    expect(find.byKey(const Key('buyPrice')), findsNothing);
    await _submit(tester);

    expect(repo.updated.single.key, 's1');
    expect(stockIns, isEmpty);
    expect(find.text('Sparepart tersimpan.'), findsOneWidget);
  });
}
