import 'package:epos_ac/features/stock/stock_adjust_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

const _produk = StockRow(
  id: 'p1',
  kind: 'product',
  name: 'AC Daikin 1 PK',
  stock: 4,
);
const _sparepart = StockRow(
  id: 's1',
  kind: 'sparepart',
  name: 'Freon R32',
  stock: 10,
  min: 2,
);

StockOverview _overview() => (
      products: const [_produk],
      spareparts: const [_sparepart],
      movements: const <MovementRow>[],
    );

/// Layar memanggil `router.pop()` setelah sukses, jadi ia butuh GoRouter yang
/// punya rute induk untuk dituju — bukan sekadar MaterialApp(home:).
Widget _wrap(List<Map<String, dynamic>> captured) {
  final router = GoRouter(
    initialLocation: '/stok/adjust',
    routes: [
      GoRoute(
        path: '/stok',
        builder: (_, __) => const Scaffold(body: Text('daftar stok')),
        routes: [
          GoRoute(
            path: 'adjust',
            builder: (_, __) => const StockAdjustScreen(),
          ),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      stockOverviewProvider.overrideWith((ref) => Future.value(_overview())),
      adjustStockCallerProvider.overrideWithValue((payload) async {
        captured.add(payload);
      }),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

/// Form ini lebih tinggi dari viewport test bawaan (800x600), jadi tombol
/// simpan tidak ikut ter-layout tanpa ini.
void _useTallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  group('buildAdjustPayload', () {
    test('barang masuk mengirim qtyChange positif', () {
      expect(
        buildAdjustPayload(
          item: _produk,
          direction: StockDirection.masuk,
          qty: 5,
          reason: 'pembelian',
          note: ' nota 123 ',
        ),
        {
          'itemKind': 'product',
          'refId': 'p1',
          'qtyChange': 5,
          'reason': 'pembelian',
          'note': 'nota 123',
        },
      );
    });

    test('barang keluar membalik tanda jumlah', () {
      final payload = buildAdjustPayload(
        item: _sparepart,
        direction: StockDirection.keluar,
        qty: 3,
        reason: 'rusak',
      );
      expect(payload['qtyChange'], -3);
      expect(payload['itemKind'], 'sparepart');
      // Catatan kosong tidak ikut dikirim.
      expect(payload.containsKey('note'), isFalse);
    });
  });

  group('previewStock', () {
    test('menambah saat masuk & mengurangi saat keluar', () {
      expect(
        previewStock(current: 4, direction: StockDirection.masuk, qty: 6),
        10,
      );
      expect(
        previewStock(current: 4, direction: StockDirection.keluar, qty: 3),
        1,
      );
    });

    test('bisa negatif — dipakai UI untuk mencegah kirim', () {
      expect(
        previewStock(current: 2, direction: StockDirection.keluar, qty: 5),
        -3,
      );
    });
  });

  testWidgets('barang masuk: payload benar & pratinjau stok akhir tampil',
      (tester) async {
    _useTallViewport(tester);
    final captured = <Map<String, dynamic>>[];
    await tester.pumpWidget(_wrap(captured));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('adjust-item')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AC Daikin 1 PK · stok 4').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('adjust-qty')), '6');
    await tester.pumpAndSettle();

    expect(find.text('Stok AC Daikin 1 PK: 4 → 10'), findsOneWidget);

    await tester.tap(find.byKey(const Key('adjust-submit')));
    await tester.pumpAndSettle();

    expect(captured, hasLength(1));
    expect(captured.single, {
      'itemKind': 'product',
      'refId': 'p1',
      'qtyChange': 6,
      'reason': 'pembelian',
    });
  });

  testWidgets('stok tidak cukup: tombol simpan terkunci & caller tak dipanggil',
      (tester) async {
    _useTallViewport(tester);
    final captured = <Map<String, dynamic>>[];
    await tester.pumpWidget(_wrap(captured));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('adjust-item')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AC Daikin 1 PK · stok 4').last);
    await tester.pumpAndSettle();

    // Arah keluar sebanyak 9 dari stok 4.
    await tester.tap(find.text('Barang Keluar'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('adjust-qty')), '9');
    await tester.pumpAndSettle();

    expect(find.text('Stok AC Daikin 1 PK tidak cukup: tersedia 4.'),
        findsOneWidget);
    final button = tester.widget<FilledButton>(
      find.ancestor(
        of: find.text('Simpan Mutasi'),
        matching: find.byType(FilledButton),
      ),
    );
    expect(button.onPressed, isNull);

    await tester.tap(find.byKey(const Key('adjust-submit')));
    await tester.pumpAndSettle();
    expect(captured, isEmpty);
  });

  testWidgets('ganti jenis item ke sparepart mengosongkan pilihan sebelumnya',
      (tester) async {
    _useTallViewport(tester);
    final captured = <Map<String, dynamic>>[];
    await tester.pumpWidget(_wrap(captured));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('adjust-item')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AC Daikin 1 PK · stok 4').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Sparepart'));
    await tester.pumpAndSettle();

    // Item produk tidak lagi terpilih; daftar kini berisi sparepart.
    expect(find.text('AC Daikin 1 PK · stok 4'), findsNothing);
    await tester.tap(find.byKey(const Key('adjust-item')));
    await tester.pumpAndSettle();
    expect(find.text('Freon R32 · stok 10'), findsWidgets);
  });

  testWidgets('arah keluar mengganti alasan default ke rusak', (tester) async {
    final captured = <Map<String, dynamic>>[];
    await tester.pumpWidget(_wrap(captured));
    await tester.pumpAndSettle();

    expect(find.text('Pembelian / Barang Masuk'), findsOneWidget);

    await tester.tap(find.text('Barang Keluar'));
    await tester.pumpAndSettle();

    expect(find.text('Rusak / Hilang'), findsOneWidget);
    expect(find.text('Pembelian / Barang Masuk'), findsNothing);
  });
}
