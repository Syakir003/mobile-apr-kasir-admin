import 'package:epos_ac/data/models/undian.dart';
import 'package:epos_ac/features/undian/undian_list_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('undianStatusTone', () {
    test('setiap status punya nada', () {
      for (final s in UndianStatus.values) {
        expect(() => undianStatusTone(s), returnsNormally);
      }
    });
  });
}
