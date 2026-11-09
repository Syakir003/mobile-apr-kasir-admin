import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:epos_ac/features/jobs/technician_multi_picker.dart';
import 'package:epos_ac/features/pos/pos_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Pilih banyak teknisi (semua setara, maks 5). Teknisi yang sedang mengerjakan job lain diberi lencana; memilihnya
/// meminta konfirmasi dulu tapi tetap boleh.
const _ani = (uid: 't1', name: 'Ani');
const _budi = (uid: 't2', name: 'Budi');

/// Mengembalikan pembaca nilai terkini (hasil `onChanged` terakhir).
Future<List<String> Function()> _pump(
  WidgetTester tester, {
  List<({String uid, String name})> technicians = const [_ani, _budi],
  List<String> initial = const [],
  Map<String, List<BusyJob>> busy = const {
    't2': [(jobId: 'j9', customerName: 'Bu Sari', location: 'Ruko A')],
  },
}) async {
  var value = List<String>.of(initial);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      techniciansProvider.overrideWith((ref) => Stream.value(technicians)),
      technicianWorkloadProvider.overrideWith((ref) async => busy),
    ],
    child: MaterialApp(
      home: Scaffold(
        body: StatefulBuilder(
          builder: (context, setState) => TechnicianMultiPicker(
            value: value,
            onChanged: (ids) => setState(() => value = ids),
          ),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
  return () => value;
}

void main() {
  testWidgets('teknisi yang sedang mengerjakan job lain diberi lencana', (tester) async {
    await _pump(tester);
    expect(find.text('Sedang mengerjakan'), findsOneWidget);
  });

  testWidgets('teknisi tidak sibuk: langsung terpilih tanpa dialog', (tester) async {
    final value = await _pump(tester);
    await tester.tap(find.byKey(const Key('tech-t1')));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(value(), ['t1']);
  });

  testWidgets('teknisi sibuk: muncul peringatan berisi nama, pelanggan, lokasi; Batal tidak memilih', (tester) async {
    final value = await _pump(tester);
    await tester.tap(find.byKey(const Key('tech-t2')));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(find.textContaining('Budi sedang mengerjakan job untuk Bu Sari (Ruko A)'), findsOneWidget);
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(value(), isEmpty);
  });

  testWidgets('teknisi sibuk: "Tetap tugaskan" memilihnya', (tester) async {
    final value = await _pump(tester);
    await tester.tap(find.byKey(const Key('tech-t2')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tetap tugaskan'));
    await tester.pumpAndSettle();
    expect(value(), ['t2']);
  });

  testWidgets('maksimal 5 teknisi: pilihan ke-6 dinonaktifkan', (tester) async {
    final six = [for (var i = 1; i <= 6; i++) (uid: 'x$i', name: 'Teknisi $i')];
    await _pump(tester, technicians: six, initial: ['x1', 'x2', 'x3', 'x4', 'x5'], busy: const {});
    final sixth = tester.widget<CheckboxListTile>(find.byKey(const Key('tech-x6')));
    expect(sixth.onChanged, isNull);
    final first = tester.widget<CheckboxListTile>(find.byKey(const Key('tech-x1')));
    expect(first.onChanged, isNotNull); // yang sudah terpilih tetap bisa dilepas
  });

  test('busyWarningText merangkum job pertama dan jumlah job lain', () {
    expect(
      busyWarningText('Budi', const [
        (jobId: 'a', customerName: 'Bu Sari', location: 'Ruko A'),
        (jobId: 'b', customerName: null, location: null),
      ]),
      'Budi sedang mengerjakan job untuk Bu Sari (Ruko A) dan 1 job lain. Tetap tugaskan?',
    );
  });
}
