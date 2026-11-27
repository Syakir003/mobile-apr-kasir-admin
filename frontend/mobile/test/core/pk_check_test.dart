import 'package:epos_ac/core/widgets/pk_check.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<bool?> Function() _open(WidgetTester tester, List<String> inputs) {
  bool? result;
  Future<void> build() => tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async => result = await confirmPk(context, inputs),
            child: const Text('simpan'),
          ),
        ),
      ));
  return () async {
    if (find.text('simpan').evaluate().isEmpty) {
      await build();
      await tester.tap(find.text('simpan'));
      await tester.pumpAndSettle();
    }
    return result;
  };
}

void main() {
  test('unusualPks: ukuran lazim lolos (titik atau koma), yang janggal tertangkap', () {
    expect(unusualPks(['0,75', '0.5', '1', '1,5', '2', '20', '', '  ']), isEmpty);
    expect(unusualPks(['3.4', '12', '0,10', '15', 'abc']), ['3.4', '12', '0,10']);
  });

  testWidgets('angka lazim: tanpa pop-up, langsung lanjut', (tester) async {
    final result = _open(tester, ['1,5']);
    expect(await result(), isTrue);
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('angka janggal: pop-up; Perbaiki membatalkan', (tester) async {
    final result = _open(tester, ['3.4']);
    await result();
    expect(find.textContaining('3.4'), findsWidgets);
    await tester.tap(find.text('Perbaiki'));
    await tester.pumpAndSettle();
    expect(await result(), isFalse);
  });

  testWidgets('Tetap simpan meneruskan', (tester) async {
    final result = _open(tester, ['12']);
    await result();
    await tester.tap(find.text('Tetap simpan'));
    await tester.pumpAndSettle();
    expect(await result(), isTrue);
  });
}
