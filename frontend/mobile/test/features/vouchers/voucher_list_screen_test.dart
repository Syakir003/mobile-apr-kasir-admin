import 'package:epos_ac/data/models/voucher.dart';
import 'package:epos_ac/features/vouchers/voucher_list_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('voucherStatusTone', () {
    test('setiap status punya nada', () {
      for (final s in VoucherStatus.values) {
        expect(() => voucherStatusTone(s), returnsNormally);
      }
    });
  });
}
