import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/features/stock/stock_detail_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const _ac = StockRow(id: 'p1', kind: 'product', name: 'AC Daikin 1 PK', stock: 3);
const _pipa = StockRow(id: 's1', kind: 'sparepart', name: 'Pipa', stock: 20, batchTracked: true);

Widget _app(StockRow row, {List<(String, String)>? unitQueries}) => ProviderScope(
      overrides: [
        stockBatchesProvider.overrideWith((ref, k) => Future.value([
              StockBatch({'id': 'b1', 'unitName': 'AC Daikin 1 PK', 'unitRole': 'indoor', 'supplierName': 'PT A',
                  'buyPrice': '3500000.00', 'stock': 2, 'createdAt': '2026-10-02T03:00:00.000Z'}),
              StockBatch({'id': 'b0', 'unitName': 'AC Daikin 1 PK', 'stock': 0, 'buyPrice': '1'}), // habis: disembunyikan
              StockBatch({'id': 'b2', 'stock': '15', 'createdAt': '2026-11-01T03:00:00.000Z'}), // tanpa modal (peran bukan admin)
            ])),
        stockUnitsProvider.overrideWith((ref, k) {
          unitQueries?.add(k);
          return Future.value([
            StockUnit({'unitCode': 'ACD-001', 'status': 'di_gudang', 'unitRole': 'indoor', 'supplierName': 'PT A',
                'receivedAt': '2026-10-02T03:00:00.000Z'}),
          ]);
        }),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: StockDetailScreen(row: row)),
    );

void main() {
  test('StockBatch: modal null bila tidak dikirim server', () {
    expect(StockBatch({'id': 'x', 'stock': '4'}).buyPrice, isNull);
    expect(StockBatch({'id': 'x', 'stock': '4', 'buyPrice': '1500.50'}).buyPrice, 1500.5);
  });

  testWidgets('produk: batch aktif tampil dengan modal, batch habis disembunyikan', (t) async {
    await t.pumpWidget(_app(_ac));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('batch-b1')), findsOneWidget);
    expect(find.byKey(const Key('batch-b0')), findsNothing);
    expect(find.text('Modal Rp 3.500.000'), findsOneWidget);
    // batch tanpa buyPrice: tidak ada baris modal
    expect(find.byKey(const Key('batch-b2')), findsOneWidget);
    expect(find.textContaining('Modal'), findsOneWidget);
  });

  testWidgets('produk: Per Unit memuat unit per QR sesuai filter status', (t) async {
    final q = <(String, String)>[];
    await t.pumpWidget(_app(_ac, unitQueries: q));
    await t.pumpAndSettle();
    await t.tap(find.text('Per Unit'));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('unit-ACD-001')), findsOneWidget);
    expect(q.last, ('p1', 'di_gudang'));
    await t.tap(find.text('Sudah keluar'));
    await t.pumpAndSettle();
    expect(q.last, ('p1', 'keluar'));
  });

  testWidgets('sparepart: tidak ada pilihan Per Unit', (t) async {
    await t.pumpWidget(_app(_pipa));
    await t.pumpAndSettle();
    expect(find.text('Per Unit'), findsNothing);
    expect(find.byKey(const Key('batch-b2')), findsOneWidget);
  });
}
