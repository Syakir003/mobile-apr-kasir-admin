import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/complaint_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job(String id, JobStatus status) => TechnicianJob(
      id: id,
      orderId: 'o1',
      memberId: 'm1',
      unitId: 'u1',
      technicianId: 't1',
      type: 'perbaikan',
      status: status,
      technicianIds: const ['t1'],
      unitBrand: 'Daikin',
      unitModel: 'FTV',
      unitRoom: 'Kamar',
    );

Widget _app(List<TechnicianJob> jobs, List<(String, Map<String, dynamic>)> sent) => ProviderScope(
      overrides: [
        createComplaintCallerProvider.overrideWithValue((anchor, body) async {
          sent.add((anchor, body));
          return 'baru1';
        }),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: Center(child: ComplaintButton(anchorJobId: 'j1', jobs: jobs))),
      ),
    );

void main() {
  test('payload: keluhan di-trim, jadwal YYYY-MM-DD, teknisi kosong tetap dikirim', () {
    final p = buildComplaintPayload(
      jobIds: const ['a', 'b'],
      complaint: '  bocor ',
      scheduled: DateTime(2026, 11, 5),
      technicianIds: const [],
    );
    expect(p, {'jobIds': ['a', 'b'], 'complaint': 'bocor', 'technicianIds': <String>[], 'scheduledDate': '2026-11-05'});
  });

  testWidgets('tanpa job selesai tombol tidak tampil', (t) async {
    await t.pumpWidget(_app([_job('j1', JobStatus.sedangDikerjakan)], []));
    expect(find.byKey(const Key('complaint-open')), findsNothing);
  });

  testWidgets('satu unit selesai: isi keluhan lalu kirim ke job jangkar', (t) async {
    final sent = <(String, Map<String, dynamic>)>[];
    await t.pumpWidget(_app([_job('j1', JobStatus.selesai)], sent));
    await t.tap(find.byKey(const Key('complaint-open')));
    await t.pumpAndSettle();

    FilledButton submit() => t.widget<FilledButton>(find.byKey(const Key('complaint-submit')));
    expect(submit().onPressed, isNull); // keluhan kosong
    await t.enterText(find.byKey(const Key('complaint-text')), 'AC masih bocor');
    await t.pump();
    expect(submit().onPressed, isNotNull);
    await t.tap(find.byKey(const Key('complaint-submit')));
    await t.pumpAndSettle();

    expect(sent.single.$1, 'j1');
    expect(sent.single.$2['jobIds'], ['j1']);
    expect(sent.single.$2['complaint'], 'AC masih bocor');
    expect(sent.single.$2['technicianIds'], ['t1']); // bawaan = teknisi job awal
  });
}
