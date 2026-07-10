import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/utils/phone.dart';

void main() {
  group('normalizePhone', () {
    const cases = <String, String>{
      // 08x → +628x
      '081234567890': '+6281234567890',
      '0812-3456-7890': '+6281234567890',
      '0812 3456 7890': '+6281234567890',
      '(0812) 345.678': '+62812345678',
      // 628x → +628x
      '6281234567890': '+6281234567890',
      '62812 345 678': '+62812345678',
      // 8x → +628x
      '81234567890': '+6281234567890',
      // sudah +62 → tetap (setelah dibersihkan)
      '+6281234567890': '+6281234567890',
      '+62 812-3456-7890': '+6281234567890',
      // bukan seluler Indonesia → dikembalikan apa adanya setelah dibersihkan
      '021 555 1234': '0215551234',
      '+1 333 4444': '+13334444',
      '': '',
    };

    cases.forEach((input, expected) {
      test("'$input' menjadi '$expected'", () {
        expect(normalizePhone(input), expected);
      });
    });
  });
}
