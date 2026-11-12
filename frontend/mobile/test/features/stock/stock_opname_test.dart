import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/features/stock/stock_opname_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const _freon = StockRow(id: 's1', kind: 'sparepart', name: 'Freon R32', stock: 10);
const _pipa = StockRow(id: 's2', kind: 'sparepart', name: 'Pipa', stock: 30, batchTracked: true);

Widget _app(List<Map<String, dynamic>> sent) => ProviderScope(
      overrides: [
        stockOverviewProvider.overrideWith((ref) => Future.value((
              products: const <StockRow>[],
              spareparts: const [_freon, _pipa],
              movements: const <MovementRow>[],
            ))),
        sparepartBatchesProvider.overrideWith((ref, id) => Future.value(
            const [SparepartBatch(id: 'b1', stock: 12, supplier: 'PT A'), SparepartBatch(id: 'b2', stock: 18)])),
        stockOpnameCallerProvider.overrideWithValue((p) async {
          sent.add(p);
          return 'ok';
        }),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const StockOpnameScreen()),
    );

void _tall(WidgetTester t) {
  t.view.physicalSize = const Size(800, 2400);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
}

void main() {
  test('buildOpnamePayload: sparepart biasa tanpa itemCostId, gulungan memakainya', () {
    expect(buildOpnamePayload(refId: 's1', physicalQty: 8, note: ' akhir bulan '), {
      'items': [
        {'kind': 'sparepart', 'refId': 's1', 'physicalQty': 8},
      ],
      'note': 'akhir bulan',
    });
    expect(buildOpnamePayload(refId: 's2', batchId: 'b1', physicalQty: 0)['items'], [
      {'kind': 'sparepart', 'refId': 's2', 'itemCostId': 'b1', 'physicalQty': 0},
    ]);
  });

  test('opnameResultText: sesuai, plus, minus', () {
    expect(opnameResultText({'delta': 0}), 'Stok sudah sesuai, tidak ada perubahan.');
    expect(opnameResultText({'delta': 3, 'systemQty': 10, 'physicalQty': 13}), 'Stok dikoreksi +3 (sistem 10, fisik 13).');
    expect(opnameResultText({'delta': -2.5, 'systemQty': 10, 'physicalQty': 7.5}), 'Stok dikoreksi -2.5 (sistem 10, fisik 7.5).');
  });

  testWidgets('sparepart biasa: pratinjau selisih dan kirim opname', (t) async {
    _tall(t);
    final sent = <Map<String, dynamic>>[];
    await t.pumpWidget(_app(sent));
    await t.pumpAndSettle();

    FilledButton submit() => t.widget<FilledButton>(find.byKey(const Key('opname-submit')));
    await t.tap(find.byKey(const Key('opname-item')));
    await t.pumpAndSettle();
    await t.tap(find.textContaining('Freon R32').last);
    await t.pumpAndSettle();
    expect(submit().onPressed, isNull); // fisik belum diisi

    await t.enterText(find.byKey(const Key('opname-physical')), '8');
    await t.pumpAndSettle();
    expect(find.textContaining('Sistem 10 → fisik 8'), findsOneWidget);
    expect(submit().onPressed, isNotNull);
    await t.tap(find.byKey(const Key('opname-submit')));
    await t.pumpAndSettle();
    expect((sent.single['items'] as List).single, {'kind': 'sparepart', 'refId': 's1', 'physicalQty': 8});
  });

  testWidgets('sparepart per gulungan: wajib pilih gulungan, kirim itemCostId', (t) async {
    _tall(t);
    final sent = <Map<String, dynamic>>[];
    await t.pumpWidget(_app(sent));
    await t.pumpAndSettle();

    FilledButton submit() => t.widget<FilledButton>(find.byKey(const Key('opname-submit')));
    await t.tap(find.byKey(const Key('opname-item')));
    await t.pumpAndSettle();
    await t.tap(find.textContaining('Pipa').last);
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('opname-physical')), '10');
    await t.pumpAndSettle();
    expect(submit().onPressed, isNull); // gulungan belum dipilih

    await t.tap(find.byKey(const Key('opname-batch')));
    await t.pumpAndSettle();
    await t.tap(find.textContaining('PT A').last);
    await t.pumpAndSettle();
    expect(find.textContaining('Sistem 12 → fisik 10'), findsOneWidget);
    await t.tap(find.byKey(const Key('opname-submit')));
    await t.pumpAndSettle();
    expect((sent.single['items'] as List).single['itemCostId'], 'b1');
  });
}
