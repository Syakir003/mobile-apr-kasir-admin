import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/product/product_list_screen.dart';
import 'package:epos_ac/features/stock/product_opname.dart';
import 'package:epos_ac/features/stock/receive_providers.dart';
import 'package:epos_ac/features/stock/stock_detail_screen.dart';
import 'package:epos_ac/features/stock/stock_opname_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

// Gudang: ketuk barang -> dua tombol, "Barang Masuk" dan "Edit". Tidak ada layar opname.

const _gudang = AppUser(uid: 'g', email: 'e', displayName: 'G', role: UserRole.gudang);
const _admin = AppUser(uid: 'a', email: 'e', displayName: 'A', role: UserRole.admin);

const _freon = <String, dynamic>{
  'id': 's1',
  'name': 'Freon R32',
  'sku': 'SP-1',
  'category': 'Gas',
  'unit': 'kg',
  'stock': '18',
  'trackingMode': 'gabungan',
  'packUnit': 'tabung',
  'packSize': '10',
  'batchTracked': true,
  'active': false,
  'pendingPrice': true,
};

const _kapasitor = <String, dynamic>{
  'id': 's2',
  'name': 'Kapasitor',
  'unit': 'pcs',
  'stock': '7',
  'active': true,
};

const _acPair = [
  {'id': 'in', 'name': 'AC Indoor', 'stock': 3, 'active': true, 'pairedProductId': 'out', 'category': 'AC 1 PK'},
  {'id': 'out', 'name': 'AC Outdoor', 'stock': 3, 'active': true, 'acRole': 'outdoor'},
];

const _freonRow = StockRow(id: 's1', kind: 'sparepart', name: 'Freon R32', stock: 18);
const _kapRow = StockRow(id: 's2', kind: 'sparepart', name: 'Kapasitor', stock: 7);
const _acRow = StockRow(id: 'in', kind: 'product', name: 'AC Indoor', stock: 3);

typedef _Log = ({
  List<Map<String, dynamic>> received,
  List<(String, Map<String, dynamic>)> edited,
  List<Map<String, dynamic>> stock,
});

Future<_Log> _pump(
  WidgetTester tester, {
  StockRow row = _freonRow,
  List<Map<String, dynamic>> rows = const [_freon],
  AppUser user = _gudang,
}) async {
  tester.view.physicalSize = const Size(800, 3000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final _Log log = (received: [], edited: [], stock: []);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      currentUserProvider.overrideWith((ref) => Stream.value(user)),
      stockDetailProvider.overrideWith((ref, k) async => stockDetailFrom(k, rows)),
      stockBatchesProvider.overrideWith((ref, k) async => [
            StockBatch({'id': 'b1', 'stock': '10', 'createdAt': '2026-11-28T03:00:00.000Z'}),
          ]),
      stockUnitsProvider.overrideWith((ref, k) async => []),
      sparepartBatchesProvider.overrideWith((ref, id) async => [
            const SparepartBatch(id: 'b1', stock: 10),
            const SparepartBatch(id: 'b2', stock: 8),
            const SparepartBatch(id: 'b0', stock: 0), // habis: tidak ditampilkan
          ]),
      productReservedProvider.overrideWith((ref, id) async => 1),
      receiveCallerProvider.overrideWithValue((payload) async {
        log.received.add(payload);
        return {'status': 'ok', 'batchId': 'b9', 'name': row.name};
      }),
      editItemCallerProvider.overrideWithValue((path, body) async => log.edited.add((path, body))),
      stockOpnameCallerProvider.overrideWithValue((payload) async {
        log.stock.add(payload);
        return 'ok';
      }),
      productOpnameCallerProvider.overrideWithValue((payload) async {
        log.stock.add(payload);
        return ['PRD-0001-U0003'];
      }),
    ],
    child: MaterialApp(theme: AppTheme.light(), home: StockDetailScreen(row: row)),
  ));
  await tester.pumpAndSettle();
  return log;
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Future<void> _type(WidgetTester tester, String key, String value) async {
  await tester.enterText(find.byKey(Key(key)), value);
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

  testWidgets('gudang: hanya stok dan dua tombol; daftar stok tertutup dulu', (tester) async {
    await _pump(tester);
    expect(find.text('Stok: 1 tabung + 8 kg = 18 kg'), findsOneWidget);
    expect(find.text('Menunggu harga'), findsOneWidget);
    expect(find.byKey(const Key('detail-receive')), findsOneWidget);
    expect(find.byKey(const Key('detail-edit')), findsOneWidget);
    expect(find.textContaining('Koreksi'), findsNothing);
    expect(find.byKey(const Key('receive-save')), findsNothing);
    expect(find.byKey(const Key('batch-b1')), findsNothing);
    await _tap(tester, 'detail-list');
    expect(find.byKey(const Key('batch-b1')), findsOneWidget);
    expect(find.text('10 kg'), findsOneWidget);
  });

  testWidgets('Barang Masuk: "3 tabung penuh" lalu simpan tanpa harga, kembali ke detail', (tester) async {
    final log = await _pump(tester);
    await _tap(tester, 'detail-receive');
    await _type(tester, 'receive-full-count', '3');
    await _tap(tester, 'receive-full-add');
    expect([for (var i = 0; i < 3; i++) _fieldText(tester, 'receive-roll-$i')], ['10', '10', '10']);
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
    expect(find.byKey(const Key('receive-save')), findsNothing);
    expect(find.byKey(const Key('detail-receive')), findsOneWidget);
    expect(find.textContaining('Barang masuk tersimpan'), findsOneWidget);
  });

  testWidgets('"tabung penuh" tidak menghapus isian lain yang sudah diketik', (tester) async {
    await _pump(tester);
    await _tap(tester, 'detail-receive');
    await _type(tester, 'receive-roll-0', '4,5');
    await _type(tester, 'receive-full-count', '1');
    await _tap(tester, 'receive-full-add');
    expect(_fieldText(tester, 'receive-roll-0'), '4.5'); // kolom angka menulis koma sebagai titik
    expect(_fieldText(tester, 'receive-roll-1'), '10');
  });

  testWidgets('Edit terisi data barang; ubah nama & satu tabung, hanya itu yang dikirim', (tester) async {
    final log = await _pump(tester);
    await _tap(tester, 'detail-edit');
    expect(_fieldText(tester, 'edit-name'), 'Freon R32');
    expect(_fieldText(tester, 'edit-sku'), 'SP-1');
    expect(_fieldText(tester, 'edit-category'), 'Gas');
    expect(_fieldText(tester, 'edit-batch-b1'), '10');
    expect(_fieldText(tester, 'edit-batch-b2'), '8');
    expect(find.byKey(const Key('edit-batch-b0')), findsNothing);

    await _type(tester, 'edit-name', 'Freon R32 Daikin');
    await _type(tester, 'edit-batch-b2', '6,5');
    await _tap(tester, 'edit-save');
    expect(log.edited.single.$1, '/spareparts/s1');
    expect(log.edited.single.$2, {'name': 'Freon R32 Daikin', 'sku': 'SP-1', 'category': 'Gas'});
    expect(log.stock.single, {
      'items': [
        {'kind': 'sparepart', 'refId': 's1', 'itemCostId': 'b2', 'physicalQty': 6.5},
      ],
    });
    expect(find.byKey(const Key('edit-save')), findsNothing);
  });

  testWidgets('Edit tanpa perubahan: tidak ada yang dikirim', (tester) async {
    final log = await _pump(tester);
    await _tap(tester, 'detail-edit');
    await _tap(tester, 'edit-save');
    expect(log.edited, isEmpty);
    expect(log.stock, isEmpty);
    expect(find.byKey(const Key('detail-edit')), findsOneWidget);
  });

  testWidgets('Edit sparepart biasa yang sudah berharga: jumlah boleh diubah, kosong ditolak', (tester) async {
    final log = await _pump(tester, row: _kapRow, rows: const [_kapasitor]);
    await _tap(tester, 'detail-edit');
    expect(_fieldText(tester, 'edit-qty'), '7');
    await _type(tester, 'edit-qty', '');
    expect(tester.widget<FilledButton>(find.byKey(const Key('edit-save'))).onPressed, isNull);
    await _type(tester, 'edit-qty', '12');
    await _tap(tester, 'edit-save');
    expect(log.edited, isEmpty);
    expect(log.stock.single, {
      'items': [
        {'kind': 'sparepart', 'refId': 's2', 'physicalQty': 12},
      ],
    });
  });

  testWidgets('Edit AC: kurangi dengan konfirmasi lalu tampil label yang dicabut', (tester) async {
    final log = await _pump(tester, row: _acRow, rows: _acPair);
    await _tap(tester, 'detail-edit');
    expect(find.byKey(const Key('edit-sku')), findsNothing);
    expect(find.textContaining('1 unit sudah dipesan'), findsOneWidget);
    await _type(tester, 'edit-qty', '2');
    await _tap(tester, 'edit-save');
    expect(log.stock, isEmpty); // menunggu konfirmasi
    await tester.tap(find.text('Ya, kurangi'));
    await tester.pumpAndSettle();
    expect(log.stock.single, {
      'items': [
        {'kind': 'product', 'refId': 'in', 'physicalQty': 2},
      ],
    });
    expect(find.textContaining('PRD-0001-U0003'), findsOneWidget);
    await tester.tap(find.text('Sudah dicabut'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('edit-save')), findsNothing);
  });

  testWidgets('Edit AC: menambah unit ditolak, diarahkan ke Barang Masuk', (tester) async {
    await _pump(tester, row: _acRow, rows: _acPair);
    await _tap(tester, 'detail-edit');
    await _type(tester, 'edit-qty', '5');
    expect(find.textContaining('lewat Barang Masuk'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('edit-save'))).onPressed, isNull);
  });

  testWidgets('Barang Masuk AC paket: Indoor + Outdoor, lalu bisa cetak label', (tester) async {
    final log = await _pump(tester, row: _acRow, rows: _acPair);
    await _tap(tester, 'detail-receive');
    await _type(tester, 'receive-qty', '2');
    await _type(tester, 'receive-outdoor-qty', '1');
    await _tap(tester, 'receive-save');
    expect(log.received.single['outdoorRefId'], 'out');
    expect(find.byKey(const Key('receive-print')), findsOneWidget);
    await tester.tap(find.text('Selesai'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('detail-receive')), findsOneWidget);
  });

  testWidgets('Outdoor paket: Barang Masuk mati, diarahkan lewat Indoor', (tester) async {
    await _pump(tester,
        row: const StockRow(id: 'out', kind: 'product', name: 'AC Outdoor', stock: 3), rows: _acPair);
    expect(tester.widget<FilledButton>(find.byKey(const Key('detail-receive'))).onPressed, isNull);
    expect(find.textContaining('lewat produk Indoor'), findsOneWidget);
  });

  testWidgets('admin: halaman lama, tanpa tombol gudang', (tester) async {
    await _pump(tester, user: _admin);
    expect(find.byKey(const Key('detail-receive')), findsNothing);
    expect(find.byKey(const Key('detail-edit')), findsNothing);
    expect(find.byKey(const Key('batch-b1')), findsOneWidget);
  });

  testWidgets('gudang mengetuk produk di daftar: membuka detail', (tester) async {
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
