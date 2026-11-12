import 'package:epos_ac/features/stock/stock_adjust_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

const _pipa = StockRow(id: 's2', kind: 'sparepart', name: 'Pipa Tembaga', stock: 0, batchTracked: true);
const _produk = StockRow(id: 'p1', kind: 'product', name: 'AC Daikin', stock: 4);

Widget _wrap(List<Map<String, dynamic>> sent, StockInResult Function(int call) result) {
  var calls = 0;
  final router = GoRouter(
    initialLocation: '/stok/adjust',
    routes: [
      GoRoute(
        path: '/stok',
        builder: (_, __) => const Scaffold(body: Text('daftar stok')),
        routes: [GoRoute(path: 'adjust', builder: (_, __) => const StockAdjustScreen())],
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      stockOverviewProvider.overrideWith((ref) => Future.value((
            products: const [_produk],
            spareparts: const [_pipa],
            movements: const <MovementRow>[],
          ))),
      stockInCallerProvider.overrideWithValue((payload) async {
        sent.add(payload);
        return result(calls++);
      }),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

void _tall(WidgetTester t) {
  t.view.physicalSize = const Size(800, 2400);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
}

void main() {
  test('buildStockInPayload: produk pakai qty; per gulungan pakai rolls tanpa qty', () {
    expect(buildStockInPayload(item: _produk, qty: 3, buyPrice: 100, supplier: ' PT A ', note: ''), {
      'kind': 'product',
      'refId': 'p1',
      'qty': 3,
      'buyPrice': 100,
      'supplierName': 'PT A',
    });
    final p = buildStockInPayload(item: _pipa, qty: 99, rolls: const [15, 7.5], buyPrice: 50, confirmOverride: true);
    expect(p['rolls'], [
      {'length': 15},
      {'length': 7.5},
    ]);
    expect(p.containsKey('qty'), isFalse);
    expect(p['confirmOverride'], isTrue);
  });

  test('parseStockInResult: konfirmasi memuat teks per item', () {
    final r = parseStockInResult({
      'status': 'confirm_required',
      'warnings': [
        {'name': 'AC Daikin', 'buyPrice': 4000000, 'sellPrice': 3500000},
      ],
    });
    expect(r.needsConfirm, isTrue);
    expect(r.warnings.single, contains('AC Daikin'));
    expect(r.warnings.single, contains('Rp 4.000.000'));
    expect(parseStockInResult({'status': 'ok'}).needsConfirm, isFalse);
    expect(parseStockInResult(null).needsConfirm, isFalse);
  });

  testWidgets('sparepart per gulungan: isi panjang gulungan, kirim rolls', (t) async {
    _tall(t);
    final sent = <Map<String, dynamic>>[];
    await t.pumpWidget(_wrap(sent, (_) => (needsConfirm: false, warnings: const <String>[])));
    await t.pumpAndSettle();

    await t.tap(find.text('Sparepart'));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('adjust-item')));
    await t.pumpAndSettle();
    await t.tap(find.textContaining('Pipa Tembaga').last);
    await t.pumpAndSettle();

    expect(find.byKey(const Key('adjust-qty')), findsNothing); // bukan jumlah tunggal
    await t.enterText(find.byKey(const Key('stock-in-roll-0')), '15');
    await t.tap(find.byKey(const Key('stock-in-add-roll')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('stock-in-roll-1')), '7,5');
    await t.enterText(find.byKey(const Key('stock-in-buy-price')), '250000');
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('adjust-submit')));
    await t.pumpAndSettle();

    expect(sent.single['rolls'], [
      {'length': 15},
      {'length': 7.5},
    ]);
    expect(sent.single['buyPrice'], 250000);
  });

  testWidgets('modal di bawah harga jual: dialog konfirmasi lalu kirim ulang dengan confirmOverride', (t) async {
    _tall(t);
    final sent = <Map<String, dynamic>>[];
    await t.pumpWidget(_wrap(sent, (call) => call == 0
        ? (needsConfirm: true, warnings: const ['AC Daikin: harga modal Rp 4.000.000 tidak di atas harga jual Rp 3.500.000'])
        : (needsConfirm: false, warnings: const <String>[])));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const Key('adjust-item')));
    await t.pumpAndSettle();
    await t.tap(find.textContaining('AC Daikin').last);
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('adjust-qty')), '2');
    await t.enterText(find.byKey(const Key('stock-in-buy-price')), '4000000');
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('adjust-submit')));
    await t.pumpAndSettle();

    expect(find.text('Harga modal tidak di atas harga jual'), findsOneWidget); // judul dialog
    expect(find.textContaining('Rp 4.000.000'), findsOneWidget); // isi peringatan dari server
    expect(sent.length, 1);
    expect(sent.first.containsKey('confirmOverride'), isFalse);

    await t.tap(find.byKey(const Key('stock-in-confirm')));
    await t.pumpAndSettle();
    expect(sent.length, 2);
    expect(sent.last['confirmOverride'], isTrue);
  });
}
