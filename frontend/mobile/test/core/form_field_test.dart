import 'package:epos_ac/core/widgets/form_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

TextEditingValue _v(String text, [int? offset]) => TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: offset ?? text.length),
    );

void main() {
  group('ThousandsSeparatorFormatter', () {
    final f = ThousandsSeparatorFormatter();

    test('menyisipkan titik tiap tiga digit', () {
      expect(f.formatEditUpdate(_v(''), _v('1')).text, '1');
      expect(f.formatEditUpdate(_v('1'), _v('12')).text, '12');
      expect(f.formatEditUpdate(_v('12'), _v('123')).text, '123');
      expect(f.formatEditUpdate(_v('123'), _v('1234')).text, '1.234');
      expect(f.formatEditUpdate(_v('1.234'), _v('12345')).text, '12.345');
      expect(f.formatEditUpdate(_v('12.345'), _v('1234567')).text, '1.234.567');
    });

    test('membuang karakter non-digit', () {
      expect(f.formatEditUpdate(_v(''), _v('12a3b4')).text, '1.234');
      expect(f.formatEditUpdate(_v(''), _v('Rp 45.200')).text, '45.200');
    });

    test('teks kosong tetap kosong, bukan "0"', () {
      expect(f.formatEditUpdate(_v('1.234'), _v('')).text, '');
    });

    test('kursor tetap di kanan digit yang sama setelah titik disisipkan', () {
      // Ketik "4" di akhir "123" → "1.234", kursor harus tetap di ujung.
      final r = f.formatEditUpdate(_v('123'), _v('1234'));
      expect(r.text, '1.234');
      expect(r.selection.end, r.text.length);
    });

    test('menyunting di tengah tidak melempar kursor ke ujung', () {
      // "1.234" dengan kursor setelah "2" (offset 3), sisipkan "9" → "12.934".
      // Dua digit ada di kanan kursor, jadi kursor harus berhenti setelah "9".
      final r = f.formatEditUpdate(_v('1.234', 3), _v('1.2934', 4));
      expect(r.text, '12.934');
      final after = r.text
          .substring(r.selection.end)
          .replaceAll(RegExp(r'[^0-9]'), '')
          .length;
      expect(after, 2);
    });
  });

  group('parseRupiahInput', () {
    test('membaca kembali nilai berpemisah', () {
      expect(parseRupiahInput('1.234.567'), 1234567);
      expect(parseRupiahInput('45.200'), 45200);
      expect(parseRupiahInput(''), 0);
      expect(parseRupiahInput('Rp 0'), 0);
    });
  });

  testWidgets('label wajib menampilkan tanda bintang', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: AppTextField(label: 'Nama Jasa', required: true),
        ),
      ),
    );

    final rich = tester.widget<Text>(find.byType(Text).first);
    expect(rich.textSpan!.toPlainText(), 'Nama Jasa *');
  });

  testWidgets('field uang memformat ketikan jadi berpemisah', (tester) async {
    final c = TextEditingController();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppMoneyField(label: 'Harga Dasar', controller: c),
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), '150000');
    expect(c.text, '150.000');
    expect(parseRupiahInput(c.text), 150000);
  });
}
