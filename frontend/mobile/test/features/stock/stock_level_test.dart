import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter_test/flutter_test.dart';

StockRow _row(num stock, {num? min}) =>
    StockRow(id: 'x', kind: 'sparepart', name: 'n', stock: stock, min: min);

void main() {
  test('level: 0 = habis, di bawah/pada minimum = menipis, sisanya aman', () {
    expect(_row(0, min: 5).level, StockLevel.habis);
    expect(_row(2, min: 5).level, StockLevel.menipis);
    expect(_row(5, min: 5).level, StockLevel.menipis);
    expect(_row(6, min: 5).level, StockLevel.aman);
  });

  test('tanpa minimum: batas menipis 3 (produk AC)', () {
    expect(_row(3).level, StockLevel.menipis);
    expect(_row(4).level, StockLevel.aman);
  });

  test('stockCounts menghitung tiap tingkat', () {
    final c = stockCounts([_row(0), _row(0, min: 2), _row(1, min: 2), _row(9)]);
    expect(c, (habis: 2, menipis: 1, aman: 1));
  });
}
