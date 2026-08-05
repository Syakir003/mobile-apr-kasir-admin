import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:epos_ac/features/members/member_providers.dart';
import 'package:epos_ac/features/members/unit_history_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

AcUnit _unit({
  DateTime? lastService,
  DateTime? nextService,
  String barcode = 'ACUNIT-20260706-0001',
}) =>
    AcUnit(
      id: 'u1',
      memberId: 'm1',
      brand: 'Daikin',
      model: 'FTV-25',
      pk: 1,
      roomLocation: 'Kamar Utama',
      barcodeValue: barcode,
      status: AcUnitStatus.aktif,
      lastServiceDate: lastService,
      nextServiceDate: nextService,
    );

TechnicianJob _job({
  required String id,
  required String type,
  required JobStatus status,
  DateTime? completedAt,
  String technician = 'Andi',
  String? notes,
}) =>
    TechnicianJob(
      id: id,
      orderId: 'o1',
      memberId: 'm1',
      unitId: 'u1',
      technicianId: 't1',
      type: type,
      status: status,
      completedAt: completedAt,
      notes: notes,
      technicianName: technician,
    );

Widget _wrap({
  AcUnit? unit,
  required List<TechnicianJob> jobs,
}) {
  return ProviderScope(
    overrides: [
      acUnitProvider('u1').overrideWith((ref) => Future.value(unit)),
      unitJobHistoryProvider('u1').overrideWith((ref) => Future.value(jobs)),
    ],
    child: const MaterialApp(home: UnitHistoryScreen(unitId: 'u1')),
  );
}

void main() {
  testWidgets('menampilkan ringkasan unit & entri riwayat terbaru dulu',
      (tester) async {
    await tester.pumpWidget(_wrap(
      unit: _unit(lastService: DateTime(2026, 7, 10, 9, 30)),
      jobs: [
        _job(
          id: 'j2',
          type: 'cuci',
          status: JobStatus.selesai,
          completedAt: DateTime(2026, 7, 10, 9, 30),
          notes: 'Filter dicuci, freon normal',
        ),
        _job(
          id: 'j1',
          type: 'pemasangan',
          status: JobStatus.selesai,
          completedAt: DateTime(2026, 5, 2, 14, 0),
        ),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.text('Daikin FTV-25'), findsOneWidget);
    expect(find.text('1.0 PK • Kamar Utama'), findsOneWidget);
    expect(find.text('ACUNIT-20260706-0001'), findsOneWidget);
    expect(find.text('2 • 2 selesai'), findsOneWidget);
    expect(find.text('10-07-2026 09:30'), findsOneWidget); // servis terakhir
    expect(find.text('Cuci AC'), findsOneWidget);
    expect(find.text('Pemasangan'), findsOneWidget);
    expect(find.text('Selesai 02-05-2026 14:00'), findsOneWidget);
    expect(find.text('Teknisi: Andi'), findsNWidgets(2));
    expect(find.text('Filter dicuci, freon normal'), findsOneWidget);
  });

  testWidgets('empty state saat unit belum pernah dikerjakan', (tester) async {
    await tester.pumpWidget(_wrap(unit: _unit(), jobs: const []));
    await tester.pumpAndSettle();

    expect(find.text('Belum ada riwayat pekerjaan untuk unit ini.'),
        findsOneWidget);
    expect(find.text('0 • 0 selesai'), findsOneWidget);
    expect(find.text('-'), findsOneWidget); // servis terakhir kosong
  });

  testWidgets('jadwal servis lewat tanggal ditandai terlewat', (tester) async {
    await tester.pumpWidget(_wrap(
      unit: _unit(nextService: DateTime(2020, 1, 5, 8, 0)),
      jobs: const [],
    ));
    await tester.pumpAndSettle();

    expect(find.text('05-01-2020 08:00 (terlewat)'), findsOneWidget);
  });

  testWidgets('unit belum termuat: layar tetap tampil dengan riwayat',
      (tester) async {
    await tester.pumpWidget(_wrap(
      unit: null,
      jobs: [
        _job(id: 'j1', type: 'service', status: JobStatus.sedangDikerjakan),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.text('Unit AC'), findsOneWidget);
    expect(find.text('Service'), findsOneWidget);
    expect(find.text('Waktu belum tercatat'), findsOneWidget);
  });

  group('historyTimeline', () {
    test('memakai stempel paling informatif yang tersedia', () {
      expect(
        historyTimeline(_job(
          id: 'j',
          type: 'cuci',
          status: JobStatus.selesai,
          completedAt: DateTime(2026, 3, 1, 8, 5),
        )),
        'Selesai 01-03-2026 08:05',
      );
      expect(
        historyTimeline(TechnicianJob(
          id: 'j',
          orderId: 'o',
          memberId: 'm',
          unitId: 'u1',
          technicianId: null,
          type: 'service',
          status: JobStatus.assigned,
          scheduledDate: DateTime(2026, 3, 4, 10, 0),
          createdAt: DateTime(2026, 3, 2, 7, 0),
        )),
        'Dijadwalkan 04-03-2026 10:00',
      );
    });
  });
}
