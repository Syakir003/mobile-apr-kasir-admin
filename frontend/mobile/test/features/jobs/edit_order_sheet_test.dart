import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/edit_order_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job(String id, {JobStatus status = JobStatus.assigned, String type = 'perbaikan'}) => TechnicianJob(
      id: id,
      orderId: 'o1',
      memberId: 'm1',
      unitId: 'u1',
      technicianId: 't1',
      type: type,
      status: status,
      scheduledDate: DateTime(2026, 11, 5),
      orderNote: 'Catatan lama',
      unitBrand: 'Daikin',
      unitModel: 'FTV',
    );

void main() {
  group('buildOrderEditPayload', () {
    Map<String, dynamic> build({
      String date = '2026-11-05',
      String type = 'perbaikan',
      bool typeEditable = true,
      String note = 'Catatan lama',
      Map<String, (String, String)>? locs,
    }) =>
        buildOrderEditPayload(
          initialDate: '2026-11-05',
          date: date,
          initialType: 'perbaikan',
          type: type,
          typeEditable: typeEditable,
          initialNote: 'Catatan lama',
          note: note,
          initialLocs: const {'j1': ('', '')},
          locs: locs ?? const {'j1': ('', '')},
        );

    test('tidak ada perubahan -> kosong', () => expect(build(), isEmpty));

    test('hanya field yang berubah yang dikirim', () {
      final p = build(date: '2026-11-09', type: 'cuci', note: ' Baru ', locs: {'j1': (' Jl. B ', '')});
      expect(p['scheduledDate'], '2026-11-09');
      expect(p['jobType'], 'cuci');
      expect(p['note'], 'Baru');
      expect(p['unitLocations'], [
        {'jobId': 'j1', 'address': 'Jl. B', 'mapsUrl': ''},
      ]);
    });

    test('jenis tidak dikirim untuk pemasangan/komplain walau berubah', () {
      expect(build(type: 'cuci', typeEditable: false).containsKey('jobType'), isFalse);
    });
  });

  testWidgets('tombol hilang bila semua job selesai', (t) async {
    await t.pumpWidget(ProviderScope(
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: EditOrderButton(jobs: [_job('j1', status: JobStatus.selesai)])),
      ),
    ));
    expect(find.byKey(const Key('edit-order-open')), findsNothing);
  });

  testWidgets('ubah catatan lalu simpan memanggil PATCH order dengan note saja', (t) async {
    final sent = <(String, Map<String, dynamic>)>[];
    await t.pumpWidget(ProviderScope(
      overrides: [
        updateServiceOrderCallerProvider.overrideWithValue((id, body) async => sent.add((id, body))),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: Center(child: EditOrderButton(jobs: [_job('j1')]))),
      ),
    ));
    await t.tap(find.byKey(const Key('edit-order-open')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('edit-order-note')), 'Catatan baru');
    await t.ensureVisible(find.byKey(const Key('edit-order-save')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('edit-order-save')));
    await t.pumpAndSettle();
    expect(sent.single.$1, 'o1');
    expect(sent.single.$2, {'note': 'Catatan baru'});
  });
}
