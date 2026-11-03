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
    expect(find.text('Tutorial Teknisi'), findsOneWidget);
    expect(find.text('Terima job'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('Mengerti'), 300);
    await tester.tap(find.text('Mengerti'));
    await tester.pumpAndSettle();
    expect(find.text('Tutorial Teknisi'), findsNothing);
  });
}
