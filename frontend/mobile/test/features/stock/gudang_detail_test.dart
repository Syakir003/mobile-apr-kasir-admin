import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/product/product_list_screen.dart';
import 'package:epos_ac/features/stock/receive_providers.dart';
import 'package:epos_ac/features/stock/stock_detail_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

// Halaman detail stok untuk gudang (padanan web): stok, koreksi, betulkan, Barang Masuk.

const _gudang = AppUser(uid: 'g', email: 'e', displayName: 'G', role: UserRole.gudang);
const _admin = AppUser(uid: 'a', email: 'e', displayName: 'A', role: UserRole.admin);

const _freon = <String, dynamic>{
  'id': 's1',
  'name': 'Freon R32',
  'sku': 'SP-1',
  'category': 'Gas',
  'unit': 'kg',
  'stock': '20',
  'trackingMode': 'gabungan',
  'packUnit': 'tabung',
  'packSize': '10',
  'batchTracked': true,
  'active': false,
  'pendingPrice': true,
};

const _acPair = [
  {'id': 'in', 'name': 'AC Indoor', 'stock': 2, 'active': true, 'pairedProductId': 'out', 'category': 'AC 1 PK'},
  {'id': 'out', 'name': 'AC Outdoor', 'stock': 2, 'active': true, 'acRole': 'outdoor'},
];

const _freonRow = StockRow(id: 's1', kind: 'sparepart', name: 'Freon R32', stock: 20);

Future<({List<Map<String, dynamic>> received, List<(String, Map<String, dynamic>)> fixed, List<Object?> opname})> _pump(
  WidgetTester tester, {
  StockRow row = _freonRow,
  List<Map<String, dynamic>> rows = const [_freon],
  AppUser user = _gudang,
}) async {
  tester.view.physicalSize = const Size(800, 3000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final received = <Map<String, dynamic>>[];
  final fixed = <(String, Map<String, dynamic>)>[];
  final opname = <Object?>[];
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, __) => StockDetailScreen(row: row)),
    GoRoute(
      path: '/stok/opname',
      builder: (_, state) {
        opname.add(state.extra);
        return const Scaffold(body: Text('opname'));
      },
    ),
  ]);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      currentUserProvider.overrideWith((ref) => Stream.value(user)),
      stockDetailProvider.overrideWith((ref, k) async => stockDetailFrom(k, rows)),
      stockBatchesProvider.overrideWith((ref, k) async => [
            StockBatch({'id': 'b1', 'stock': '10', 'createdAt': '2026-11-28T03:00:00.000Z'}),
          ]),
      stockUnitsProvider.overrideWith((ref, k) async => []),
      receiveCallerProvider.overrideWithValue((payload) async {
        received.add(payload);
        return {'status': 'ok', 'batchId': 'b9', 'name': row.name};
      }),
      fixPendingCallerProvider.overrideWithValue((path, body) async => fixed.add((path, body))),
    ],
    child: MaterialApp.router(theme: AppTheme.light(), routerConfig: router),
  ));
  await tester.pumpAndSettle();
  return (received: received, fixed: fixed, opname: opname);
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

String _fieldText(WidgetTester tester, String key) => tester
    .widget<EditableText>(find.descendant(of: find.byKey(Key(key)), matching: find.byType(EditableText)))
    .controller
    .text;

void main() {
  test('stok ditulis seperti web: kemasan utuh + sisa', () {
    String text(String stock) => stockText({..._freon, 'stock': stock});
    expect(text('20'), '2 tabung = 20 kg');
    expect(text('25'), '2 tabung + 5 kg = 25 kg');
    expect(text('7'), '7 kg');
    expect(stockText({'stock': '12', 'unit': 'pcs'}), '12 pcs');
    expect(stockText({'stock': 3}), '3 unit');
  });

  testWidgets('gudang: stok, status, dan tombol; koreksi hanya dibuka lewat tombolnya', (tester) async {
    final log = await _pump(tester);
    expect(find.text('Stok: 2 tabung = 20 kg'), findsOneWidget);
    expect(find.text('Menunggu harga'), findsOneWidget);
    expect(find.text('Barang Masuk'), findsOneWidget);
    expect(find.byKey(const Key('batch-b1')), findsOneWidget);
    expect(find.text('Daftar tabung'), findsOneWidget);
    expect(find.text('10 kg'), findsOneWidget);
    expect(log.opname, isEmpty);
    await _tap(tester, 'detail-fix-stock');
    expect(log.opname, ['s1']);
  });

  testWidgets('gudang: "3 tabung penuh" mengisi baris, simpan tanpa harga, form kosong lagi', (tester) async {
    final log = await _pump(tester);
    await tester.enterText(find.byKey(const Key('receive-full-count')), '3');
    await _tap(tester, 'receive-full-add');
    expect([for (var i = 0; i < 3; i++) _fieldText(tester, 'receive-roll-$i')], ['10', '10', '10']);
    expect(find.byKey(const Key('receive-roll-3')), findsNothing);

    await _tap(tester, 'receive-remove-roll-2');
    await _tap(tester, 'receive-save');
    expect(log.received.single, {
      'kind': 'sparepart',
      'refId': 's1',
      'rolls': [
        {'length': 10},
        {'length': 10},
      ],
    });
    expect(_fieldText(tester, 'receive-roll-0'), '');
    expect(find.textContaining('Barang masuk tersimpan'), findsOneWidget);
  });

  testWidgets('"tabung penuh" tidak menghapus isian lain yang sudah diketik', (tester) async {
    await _pump(tester);
    await tester.enterText(find.byKey(const Key('receive-roll-0')), '4,5');
    await tester.enterText(find.byKey(const Key('receive-full-count')), '1');
    await _tap(tester, 'receive-full-add');
    expect(_fieldText(tester, 'receive-roll-0'), '4.5'); // kolom angka menulis koma sebagai titik
    expect(_fieldText(tester, 'receive-roll-1'), '10');
  });

  testWidgets('gudang: Betulkan mengirim nama, SKU, kategori', (tester) async {
    final log = await _pump(tester);
    await _tap(tester, 'detail-fix-item');
    await tester.enterText(find.byKey(const Key('fix-name')), 'Freon R32 Daikin');
    await _tap(tester, 'fix-save');
    expect(log.fixed.single.$1, '/spareparts/s1');
    expect(log.fixed.single.$2, {'name': 'Freon R32 Daikin', 'sku': 'SP-1', 'category': 'Gas'});
  });

  testWidgets('gudang: barang yang sudah berharga tidak punya tombol Betulkan', (tester) async {
    await _pump(tester, rows: [
      {..._freon, 'active': true, 'pendingPrice': false}
    ]);
    expect(find.byKey(const Key('detail-fix-item')), findsNothing);
    expect(find.text('Menunggu harga'), findsNothing);
  });

  testWidgets('gudang: AC paket diterima Indoor + Outdoor lalu bisa cetak label', (tester) async {
    final log = await _pump(tester,
        row: const StockRow(id: 'in', kind: 'product', name: 'AC Indoor', stock: 2), rows: _acPair);
    expect(find.text('Stok: 2 unit'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('receive-qty')), '2');
    await tester.enterText(find.byKey(const Key('receive-outdoor-qty')), '1');
    await tester.pumpAndSettle();
    await _tap(tester, 'receive-save');
    expect(log.received.single['outdoorRefId'], 'out');
    expect(find.byKey(const Key('receive-print')), findsOneWidget);
    expect(find.text('Per Unit'), findsOneWidget);
  });

  testWidgets('gudang: Outdoor paket diterima lewat Indoor, tanpa form', (tester) async {
    await _pump(tester,
        row: const StockRow(id: 'out', kind: 'product', name: 'AC Outdoor', stock: 2), rows: _acPair);
    expect(find.byKey(const Key('receive-save')), findsNothing);
    expect(find.textContaining('lewat produk Indoor'), findsOneWidget);
  });

  testWidgets('admin: halaman lama, tanpa form Barang Masuk', (tester) async {
    await _pump(tester, user: _admin);
    expect(find.byKey(const Key('receive-save')), findsNothing);
    expect(find.text('Barang Masuk'), findsNothing);
    expect(find.byKey(const Key('batch-b1')), findsOneWidget);
  });

  testWidgets('gudang mengetuk produk di daftar: membuka detail, bukan opname', (tester) async {
    Object? opened;
    final router = GoRouter(routes: [
      GoRoute(path: '/', builder: (_, __) => const ProductListScreen()),
      GoRoute(
        path: '/stok/detail',
        builder: (_, state) {
          opened = state.extra;
          return const Scaffold(body: Text('detail'));
        },
      ),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => Stream.value(_gudang)),
        productListProvider.overrideWith((ref) => Stream.value([
              Product.fromMap('p9', {'name': 'AC Window', 'active': true, 'stock': 4}),
            ])),
      ],
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AC Window'));
    await tester.pumpAndSettle();
    expect(find.text('detail'), findsOneWidget);
    final row = opened as StockRow;
    expect((row.id, row.kind, row.name, row.stock), ('p9', 'product', 'AC Window', 4));
  });
}
