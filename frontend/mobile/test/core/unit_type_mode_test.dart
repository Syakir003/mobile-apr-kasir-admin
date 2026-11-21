import 'package:epos_ac/core/widgets/unit_type_mode.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('dua pilihan ala web: Tipe diketahui / QR dulu; keterangan hanya muncul di QR dulu', (tester) async {
    var qr = false;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: StatefulBuilder(
          builder: (context, setState) => UnitTypeMode(qrDulu: qr, onChanged: (v) => setState(() => qr = v)),
        ),
      ),
    ));

    expect(find.byType(Switch), findsNothing);
    expect(find.text('Tipe diketahui'), findsOneWidget);
    expect(find.textContaining('diisi teknisi'), findsNothing);

    await tester.tap(find.text('QR dulu'));
    await tester.pumpAndSettle();
    expect(qr, isTrue);
    expect(find.textContaining('diisi teknisi'), findsOneWidget);

    await tester.tap(find.text('Tipe diketahui'));
    await tester.pumpAndSettle();
    expect(qr, isFalse);
  });

  testWidgets('enabled=false: pilihan tidak bisa diubah', (tester) async {
    var qr = false;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: UnitTypeMode(qrDulu: qr, enabled: false, onChanged: (v) => qr = v)),
    ));
    await tester.tap(find.text('QR dulu'));
    await tester.pumpAndSettle();
    expect(qr, isFalse);
  });
}
