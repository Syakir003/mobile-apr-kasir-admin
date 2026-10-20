import 'package:epos_ac/core/utils/snake_keys.dart';
import 'package:epos_ac/data/models/voucher.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('snakeKeys mengubah kunci level atas saja', () {
    expect(snakeKeys({'maxDiscountCap': 1, 'member': {'fooBar': 2}}),
        {'max_discount_cap': 1, 'member': {'fooBar': 2}});
  });

  test('baris voucher Nest terbaca Voucher.fromMap', () {
    final v = Voucher.fromMap('v1', snakeKeys({
      'code': 'ABC',
      'memberId': 'm1',
      'discountType': 'persen',
      'discountValue': 10,
      'expiresAt': '2026-12-31T00:00:00.000Z',
      'createdAt': '2026-09-30T00:00:00.000Z',
    }));
    expect(v.memberId, 'm1');
    expect(v.discountValue, 10);
    expect(v.createdAt, isNotNull);
  });
}
