import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/product/product_form_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';

import '../../support/fake_crud_repository.dart';

const _existing = Product(
  id: 'p1',
  name: 'AC Lama',
  brand: 'Sharp',
  type: 'Split',
  pk: 1,
  inverter: false,
  buyPrice: 0,
  sellPrice: 3500000,
  stock: 4,
  category: 'AC',
  active: true,
);

Widget _host(
  FakeCrudRepository<Product> repo, {
  Product? initial,
  List<Map<String, dynamic>>? stockIns,
  bool stockInFails = false,
}) {
  final router = GoRouter(
    initialLocation: '/products/new',
    routes: [
      GoRoute(
        path: '/products',
        builder: (_, __) => const Scaffold(body: Text('list')),
        routes: [
          GoRoute(
              path: 'new',
              builder: (_, __) => ProductFormScreen(initial: initial)),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      productRepositoryProvider.overrideWithValue(repo),
      stockInCallerProvider.overrideWithValue((payload) async {
        if (stockInFails) throw Exception('server menolak');
        stockIns?.add(payload);
        return (needsConfirm: false, warnings: const <String>[]);
      }),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

Future<FakeCrudRepository<Product>> _pump(
  WidgetTester tester, {
  Product? initial,
  List<Map<String, dynamic>>? stockIns,
  bool stockInFails = false,
}) async {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final repo = FakeCrudRepository<Product>();
  addTearDown(repo.dispose);
  await tester.pumpWidget(_host(repo,
      initial: initial, stockIns: stockIns, stockInFails: stockInFails));
  await tester.pumpAndSettle();
  return repo;
}

Future<void> _type(WidgetTester tester, String key, String text) =>
    tester.enterText(find.byKey(Key(key)), text);

Future<void> _fillRequired(WidgetTester tester) async {
  await _type(tester, 'name', 'AC Baru');
  await _type(tester, 'brand', 'Daikin');
  await _type(tester, 'type', 'FTV');
  await _type(tester, 'pk', '1.5');
  await _type(tester, 'sellPrice', '3500000');
}

Future<void> _submit(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('submit')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('submit kosong menampilkan error validasi', (tester) async {
    final repo = await _pump(tester);
    await _submit(tester);
    expect(find.text('Wajib diisi'), findsWidgets);
    expect(repo.created, isEmpty);
  });

  testWidgets('tanpa stok awal: produk dibuat, tidak ada barang masuk',
      (tester) async {
    final stockIns = <Map<String, dynamic>>[];
    final repo = await _pump(tester, stockIns: stockIns);
    await _fillRequired(tester);
    await _submit(tester);

    expect(repo.created.single.name, 'AC Baru');
    expect(repo.created.single.sellPrice, 3500000);
    expect(stockIns, isEmpty);
    expect(find.text('list'), findsOneWidget);
    expect(find.text('Produk tersimpan.'), findsOneWidget);
  });

  testWidgets('stok awal dicatat sebagai barang masuk dengan harga modal',
      (tester) async {
    final stockIns = <Map<String, dynamic>>[];
    final repo = await _pump(tester, stockIns: stockIns);
    await _fillRequired(tester);
    await _type(tester, 'stock', '2');
    await _type(tester, 'buyPrice', '3000000');
    await _submit(tester);

    expect(repo.created, hasLength(1));
    expect(stockIns.single, {
      'kind': 'product',
      'refId': 'fake-0',
      'qty': 2,
      'buyPrice': 3000000,
      'note': 'Stok awal',
      'confirmOverride': true,
    });
    expect(find.text('list'), findsOneWidget);
  });

  testWidgets('stok awal diisi tapi harga modal kosong: ditolak',
      (tester) async {
    final repo = await _pump(tester);
    await _fillRequired(tester);
    await _type(tester, 'stock', '2');
    await _submit(tester);

    expect(repo.created, isEmpty);
    expect(find.text('Wajib diisi'), findsOneWidget);
  });

  testWidgets('modal tidak di bawah harga jual: Batal tidak menyimpan apa pun',
      (tester) async {
    final stockIns = <Map<String, dynamic>>[];
    final repo = await _pump(tester, stockIns: stockIns);
    await _fillRequired(tester);
    await _type(tester, 'stock', '1');
    await _type(tester, 'buyPrice', '4000000');
    await _submit(tester);
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();

    expect(repo.created, isEmpty);
    expect(stockIns, isEmpty);
  });

  testWidgets('barang masuk gagal: produk tidak dibuat dua kali',
      (tester) async {
    final repo = await _pump(tester, stockInFails: true);
    await _fillRequired(tester);
    await _type(tester, 'stock', '2');
    await _type(tester, 'buyPrice', '3000000');
    await _submit(tester);

    expect(repo.created, hasLength(1));
    expect(find.text('list'), findsOneWidget); // keluar dari form
    expect(find.textContaining('Produk tersimpan, tetapi'), findsOneWidget);
  });

  testWidgets('garansi/deskripsi produk baru dikirim lewat update',
      (tester) async {
    final repo = await _pump(tester);
    await _fillRequired(tester);
    await _type(tester, 'description', 'hemat listrik');
    await _submit(tester);

    expect(repo.updated.single.key, 'fake-0');
    expect(repo.updated.single.value.description, 'hemat listrik');
  });

  testWidgets('edit: tidak ada isian stok & modal, simpan berhasil',
      (tester) async {
    final stockIns = <Map<String, dynamic>>[];
    final repo = await _pump(tester, initial: _existing, stockIns: stockIns);

    expect(find.byKey(const Key('stock')), findsNothing);
    expect(find.byKey(const Key('buyPrice')), findsNothing);
    await _submit(tester);

    expect(repo.updated.single.key, 'p1');
    expect(stockIns, isEmpty);
    expect(find.text('Produk tersimpan.'), findsOneWidget);
  });
}
