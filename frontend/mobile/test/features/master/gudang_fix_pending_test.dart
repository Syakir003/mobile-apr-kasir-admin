import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:flutter_test/flutter_test.dart';

// Penanda "menunggu harga". Alur Betulkan diuji di features/stock/gudang_detail_test.dart.

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

}
