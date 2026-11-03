import 'package:epos_ac/features/jobs/teknisi_tutorial.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('showTeknisiTutorial membuka lembar panduan dan bisa ditutup', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => showTeknisiTutorial(context),
            child: const Text('buka'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();
    expect(find.text('Alur kerja teknisi'), findsOneWidget);
    expect(find.text('Mulai pekerjaan'), findsOneWidget);

    Navigator.of(tester.element(find.text('Alur kerja teknisi'))).pop();
    await tester.pumpAndSettle();
    expect(find.text('Alur kerja teknisi'), findsNothing);
  });
}
