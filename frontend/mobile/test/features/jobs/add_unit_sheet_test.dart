import 'package:epos_ac/features/jobs/add_unit_sheet.dart';
import 'package:epos_ac/features/jobs/job_providers.dart' show AddUnitInput;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

FilledButton _submit(WidgetTester tester) =>
    tester.widget<FilledButton>(find.byKey(const Key('add-unit-submit')));

void main() {
  testWidgets('AC tanpa label: wajib isi keluhan, hasilnya newUnit tanpa barcode', (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    AddUnitInput? result;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () async => result = await showModalBottomSheet<AddUnitInput>(
              context: context,
              isScrollControlled: true,
              builder: (_) => AddUnitSheet(jobType: 'cuci', onScan: () async => null),
            ),
            child: const Text('buka'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('AC tanpa label'));
    await tester.pumpAndSettle();
    expect(_submit(tester).onPressed, isNull, reason: 'keluhan kosong');

    await tester.enterText(find.byKey(const Key('add-unit-complaint')), '  Cuci AC ');
    await tester.enterText(find.byKey(const Key('add-unit-room')), 'Kamar Utama');
    await tester.pump();
    expect(_submit(tester).onPressed, isNotNull);

    await tester.tap(find.byKey(const Key('add-unit-submit')));
    await tester.pumpAndSettle();
    expect(result, isNotNull);
    expect(result!.newUnit, isTrue);
    expect(result!.barcode, isNull);
    expect(result!.complaint, 'Cuci AC');
    expect(result!.jobType, 'cuci', reason: 'default mengikuti jenis job');
    expect(result!.roomLocation, 'Kamar Utama');
  });

  testWidgets('Sudah berlabel: tombol aktif hanya setelah QR terbaca', (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    AddUnitInput? result;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () async => result = await showModalBottomSheet<AddUnitInput>(
              context: context,
              isScrollControlled: true,
              builder: (_) => AddUnitSheet(jobType: 'service', onScan: () async => 'APR-0001'),
            ),
            child: const Text('buka'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('add-unit-complaint')), 'Kurang dingin');
    await tester.pump();
    expect(_submit(tester).onPressed, isNull, reason: 'belum scan');

    await tester.tap(find.byKey(const Key('add-unit-scan')));
    await tester.pumpAndSettle();
    expect(find.text('Kode terbaca: APR-0001'), findsOneWidget);
    expect(_submit(tester).onPressed, isNotNull);

    await tester.tap(find.byKey(const Key('add-unit-submit')));
    await tester.pumpAndSettle();
    expect(result!.barcode, 'APR-0001');
    expect(result!.newUnit, isFalse);
    expect(result!.jobType, 'perbaikan', reason: 'jenis job tak dikenal jatuh ke perbaikan');
    expect(result!.roomLocation, isNull);
  });
}
