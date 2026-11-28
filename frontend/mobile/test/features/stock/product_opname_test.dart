import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/features/stock/product_opname.dart';
import 'package:epos_ac/features/stock/stock_opname_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// Gudang mengetik jumlah unit AC yang benar; kode unit yang dihapus ditampilkan supaya labelnya dicabut.

const _ac = StockRow(id: 'p1', kind: 'product', name: 'AC Uji 1 PK', stock: 4);

Future<List<Map<String, dynamic>>> _pump(WidgetTester t, {int reserved = 0}) async {
  t.view.physicalSize = const Size(400, 1400);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  final sent = <Map<String, dynamic>>[];
  await t.pumpWidget(ProviderScope(
    overrides: [
      stockOverviewProvider.overrideWith((ref) async =>
          (products: const [_ac], spareparts: const <StockRow>[], movements: const <MovementRow>[])),
      productReservedProvider.overrideWith((ref, id) async => reserved),
      productOpnameCallerProvider.overrideWithValue((p) async {
        sent.add(p);
        return ['PRD-0001-U0003', 'PRD-0001-U0004'];
      }),
    ],
    // Dibuka dari barang tertentu: langsung bagian Produk AC dengan barang terpilih.
    child: MaterialApp(theme: AppTheme.light(), home: const StockOpnameScreen(initialItemId: 'p1')),
  ));
  await t.pumpAndSettle();
  return sent;
}

FilledButton _submit(WidgetTester t) => t.widget<FilledButton>(find.byKey(const Key('opname-product-submit')));

Future<void> _qty(WidgetTester t, String v) async {
  await t.enterText(find.byKey(const Key('opname-qty')), v);
  await t.pumpAndSettle();
}

void main() {
  testWidgets('jumlah lebih kecil: konfirmasi, kirim, lalu daftar label yang dicabut', (t) async {
    final sent = await _pump(t, reserved: 1);
    expect(find.textContaining('Tercatat tersedia: 4 unit'), findsOneWidget);
    expect(find.textContaining('1 unit sudah dipesan invoice'), findsOneWidget);
    await _qty(t, '2');
    await t.tap(find.byKey(const Key('opname-product-submit')));
    await t.pumpAndSettle();
    expect(sent, isEmpty); // belum dikonfirmasi
    await t.tap(find.text('Ya, kurangi'));
    await t.pumpAndSettle();

    expect(sent.single, {
      'items': [
        {'kind': 'product', 'refId': 'p1', 'physicalQty': 2},
      ],
    });
    expect(find.textContaining('Cabut label'), findsOneWidget);
    expect(find.textContaining('PRD-0001-U0004'), findsOneWidget);
  });

  testWidgets('sama atau lebih besar: tombol mati, tambahan diarahkan ke Terima Barang', (t) async {
    await _pump(t);
    expect(_submit(t).onPressed, isNull);
    await _qty(t, '4');
    expect(_submit(t).onPressed, isNull);
    await _qty(t, '6');
    expect(_submit(t).onPressed, isNull);
    expect(find.textContaining('Terima Barang'), findsOneWidget);
  });
}
