import 'package:epos_ac/data/models/voucher.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _row({
  String discountType = 'nominal',
  Object? discountValue = 50000,
  Object? maxCap,
  Object? minPurchase,
  String status = 'aktif',
  String source = 'manual',
}) =>
    {
      'code': 'VCR-ABC123',
      'member_id': 'm1',
      'discount_type': discountType,
      'discount_value': discountValue,
      'max_discount_cap': maxCap,
      'min_purchase': minPurchase,
      'expires_at': '2026-09-30',
      'status': status,
      'source': source,
      'note': null,
      'created_at': '2026-08-17T02:00:00Z',
    };

void main() {
  group('Voucher.fromMap', () {
    test('memetakan kolom apa adanya', () {
      final v = Voucher.fromMap('v1', _row());
      expect(v.id, 'v1');
      expect(v.code, 'VCR-ABC123');
      expect(v.discountType, VoucherDiscountType.nominal);
      expect(v.discountValue, 50000);
      expect(v.status, VoucherStatus.aktif);
      expect(v.source, VoucherSource.manual);
    });

    test('semua status dikenali', () {
      for (final s in VoucherStatus.values) {
        expect(Voucher.fromMap('v', _row(status: s.value)).status, s);
      }
    });

    test('discountLabel persen vs nominal', () {
      final nominal = Voucher.fromMap('v', _row());
      expect(nominal.discountLabel, 'Rp 50000');
      final persen =
          Voucher.fromMap('v', _row(discountType: 'persen', discountValue: 10));
      expect(persen.discountLabel, '10%');
    });
  });
}
