import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/sparepart/sparepart_list_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// Gudang boleh membetulkan nama/SKU/kategori barang yang masih menunggu harga.

Sparepart _row(String id, Map<String, dynamic> extra) => Sparepart.fromMap(id, {
      'name': 'Barang $id',
      'sku': 'SP-$id',
      'category': 'Gas',
      'unit': 'kg',
      'sell_price': '0',
      'stock': '0',
      'min_stock': '0',
      'active': false,
      'tracking_mode': 'biasa',
      ...extra,
    });

Future<List<(String, Map<String, dynamic>)>> _pump(WidgetTester tester, List<Sparepart> items) async {
  final sent = <(String, Map<String, dynamic>)>[];
  await tester.pumpWidget(ProviderScope(
    overrides: [
      currentUserProvider.overrideWith((ref) =>
          Stream.value(const AppUser(uid: 'g', email: 'e', displayName: 'G', role: UserRole.gudang))),
      sparepartListProvider.overrideWith((ref) => Stream.value(items)),
      fixPendingCallerProvider.overrideWithValue((path, body) async => sent.add((path, body))),
    ],
    child: const MaterialApp(home: SparepartListScreen()),
  ));
  await tester.pumpAndSettle();
  return sent;
}

void main() {
  test('menunggu harga: belum aktif tanpa harga, atau kemasan tanpa harga utuh', () {
    expect(_row('1', {}).pendingPrice, isTrue);
    expect(_row('2', {'sell_price': '5000'}).pendingPrice, isFalse);
    expect(_row('3', {'sell_price': '5000', 'tracking_mode': 'gabungan'}).pendingPrice, isTrue);
    expect(_row('4', {'active': true}).pendingPrice, isFalse);
    Product product(Map<String, dynamic> m) => Product.fromMap('p', {'active': false, 'sell_price': '0', ...m});
    expect(product({}).pendingPrice, isTrue);
    expect(product({'ac_role': 'outdoor'}).pendingPrice, isFalse);
  });

  testWidgets('gudang membetulkan barang menunggu harga: hanya nama, SKU, kategori terkirim', (tester) async {
    final sent = await _pump(tester, [_row('1', {})]);
    expect(find.text('Menunggu harga'), findsOneWidget);
    await tester.tap(find.text('Barang 1'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('fix-name')), 'Freon R32');
    await tester.tap(find.byKey(const Key('fix-save')));
    await tester.pumpAndSettle();

    expect(sent.single.$1, '/spareparts/1');
    expect(sent.single.$2, {'name': 'Freon R32', 'sku': 'SP-1', 'category': 'Gas'});
    expect(find.byKey(const Key('fix-name')), findsNothing);
  });
}
