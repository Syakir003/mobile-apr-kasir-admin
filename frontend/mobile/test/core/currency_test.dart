import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/utils/currency.dart';

void main() {
  group('formatRupiah', () {
    test('menyisipkan pemisah ribuan', () {
      expect(formatRupiah(5500000), 'Rp 5.500.000');
      expect(formatRupiah(104900), 'Rp 104.900');
      expect(formatRupiah(1000), 'Rp 1.000');
    });

    test('angka di bawah seribu tanpa pemisah', () {
      expect(formatRupiah(0), 'Rp 0');
      expect(formatRupiah(999), 'Rp 999');
    });

    test('nilai negatif memakai tanda minus setelah "Rp"', () {
      expect(formatRupiah(-103773849), 'Rp -103.773.849');
    });

    test('formatRupiahNum membulatkan pecahan', () {
      expect(formatRupiahNum(1500.4), 'Rp 1.500');
      expect(formatRupiahNum(1500.5), 'Rp 1.501');
    });
  });
  group('formatRupiahShort', () {
    test('di bawah satu juta tetap format penuh', () {
      expect(formatRupiahShort(0), 'Rp 0');
      expect(formatRupiahShort(1500), 'Rp 1.500');
      expect(formatRupiahShort(999999), 'Rp 999.999');
    });

    test('juta & miliar diringkas dengan satu desimal', () {
      expect(formatRupiahShort(1500000), 'Rp 1,5 jt');
      expect(formatRupiahShort(16800000), 'Rp 16,8 jt');
      expect(formatRupiahShort(2000000000), 'Rp 2 M');
      expect(formatRupiahShort(2500000000), 'Rp 2,5 M');
    });

    test('nilai bulat tidak menyisakan ",0"', () {
      expect(formatRupiahShort(2000000), 'Rp 2 jt');
      expect(formatRupiahShort(1000000000), 'Rp 1 M');
    });

    test('nilai negatif memakai tanda minus setelah "Rp"', () {
      expect(formatRupiahShort(-1500000), 'Rp -1,5 jt');
      expect(formatRupiahShort(-1500), 'Rp -1.500');
    });
  });
}
