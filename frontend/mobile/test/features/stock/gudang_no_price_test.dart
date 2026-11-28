import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/features/stock/receive_providers.dart';
import 'package:flutter_test/flutter_test.dart';

// Server tidak mengirim harga apa pun ke gudang; gantinya penanda pendingPrice.

void main() {
  test('model memakai penanda server, bukan menebak dari harga yang tidak ada', () {
    Sparepart sp(bool pending) =>
        Sparepart.fromMap('s', {'name': 'X', 'active': false, 'pending_price': pending});
    expect(sp(true).pendingPrice, isTrue);
    expect(sp(false).pendingPrice, isFalse); // dinonaktifkan admin, bukan menunggu harga
    expect(Product.fromMap('p', {'active': false, 'pending_price': false}).pendingPrice, isFalse);
  });

  test('Terima Barang: aktif + menunggu harga saja, walau harga tidak dikirim', () {
    final items = receiveItemsFrom(products: [
      {'id': 'a', 'name': 'Aktif', 'active': true, 'pendingPrice': false},
      {'id': 'b', 'name': 'Menunggu', 'active': false, 'pendingPrice': true},
      {'id': 'c', 'name': 'Dimatikan', 'active': false, 'pendingPrice': false},
    ], spareparts: []);
    expect(items.map((i) => i.id), ['a', 'b']);
  });
}
