import 'package:epos_ac/core/utils/snake_keys.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/models/service_item.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:flutter_test/flutter_test.dart';

// Bentuk respons GET /products, /spareparts, /services Nest: camelCase, Decimal Prisma = string.
void main() {
  test('produk dari Nest', () {
    final p = Product.fromMap('p1', snakeKeys({
      'id': 'p1', 'name': 'AC Split 1PK', 'brand': 'Daikin', 'type': null, 'pk': '1.00', 'inverter': true,
      'btu': 9000, 'sellPrice': '3500000.00', 'stock': 4, 'photoUrl': null, 'category': 'ac', 'active': true,
    }));
    expect((p.name, p.type, p.pk, p.sellPrice, p.stock, p.inverter), ('AC Split 1PK', '', 1.0, 3500000, 4, true));
  });

  test('sparepart dari Nest', () {
    final s = Sparepart.fromMap('s1', snakeKeys({
      'id': 's1', 'name': 'Pipa', 'sku': null, 'unit': 'meter', 'sellPrice': '45000.00',
      'stock': '12.50', 'minStock': '2.00', 'active': false,
    }));
    expect((s.sellPrice, s.stock, s.minStock, s.active), (45000, 12.5, 2, false));
  });

  test('jasa dari Nest', () {
    final s = ServiceItem.fromMap('j1', snakeKeys({
      'id': 'j1', 'name': 'Cuci AC', 'category': 'cuci', 'basePrice': '75000.00', 'durationMinutes': 60, 'active': true,
    }));
    expect((s.basePrice, s.durationMinutes), (75000, 60));
  });
}
