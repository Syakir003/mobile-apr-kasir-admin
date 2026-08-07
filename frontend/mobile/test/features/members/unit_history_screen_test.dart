import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/models/job_history_extra.dart';
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
  DateTime? createdAt,
  DateTime? scheduledDate,
  DateTime? startedAt,
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
      createdAt: createdAt,
      scheduledDate: scheduledDate,
      startedAt: startedAt,
      completedAt: completedAt,
      notes: notes,
      technicianName: technician,
    );

Widget _wrap({
  AcUnit? unit,
  required List<TechnicianJob> jobs,
  Map<String, JobHistoryExtra> extras = const {},
}) {
  return ProviderScope(
    overrides: [
      acUnitProvider('u1').overrideWith((ref) => Future.value(unit)),
      unitHistoryProvider('u1')
          .overrideWith((ref) => Future.value((jobs: jobs, extras: extras))),
    ],
    child: const MaterialApp(home: UnitHistoryScreen(unitId: 'u1')),
  );
}

/// Persempit pencarian ke satu kartu entri riwayat. Perlu karena teks seperti
/// "Cuci AC" atau "Selesai" juga muncul di chip filter dan kotak statistik.
Finder _inTile(String jobId, Finder matching) =>
    find.descendant(of: find.byKey(Key('history-$jobId')), matching: matching);

/// Layar riwayat sekarang jauh lebih tinggi (kartu unit + statistik + filter +
/// kartu entri berisi rentetan waktu). Pada viewport uji bawaan 800x600, entri
/// kedua ke bawah tak pernah ikut dibangun ListView sehingga finder-nya kosong
/// — bukan karena widget-nya salah. Perbesar viewport untuk tiap tes.
void _useTallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('menampilkan ringkasan unit & entri riwayat terbaru dulu',
      (tester) async {
    _useTallViewport(tester);
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
    expect(find.text('10-07-2026 09:30'), findsNWidgets(2)); // servis terakhir + stempel
    // "Cuci AC"/"Pemasangan" muncul dua kali (chip filter + judul kartu), jadi
    // pengecekan dipersempit ke kartu entrinya.
    expect(_inTile('j2', find.text('Cuci AC')), findsOneWidget);
    expect(_inTile('j1', find.text('Pemasangan')), findsOneWidget);
    expect(find.text('02-05-2026 14:00'), findsOneWidget);
    expect(find.text('Andi'), findsNWidgets(2));
    expect(find.text('Filter dicuci, freon normal'), findsOneWidget);
    // Kotak statistik: 2 pekerjaan, 2 selesai.
    expect(find.byKey(const Key('history-stats')), findsOneWidget);
    expect(find.text('2 entri'), findsOneWidget);
  });

  testWidgets('rentetan stempel waktu ditampilkan lengkap & berurutan',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(
      unit: _unit(),
      jobs: [
        _job(
          id: 'j1',
          type: 'service',
          status: JobStatus.selesai,
          createdAt: DateTime(2026, 3, 1, 8, 0),
          scheduledDate: DateTime(2026, 3, 2, 9, 0),
          startedAt: DateTime(2026, 3, 2, 9, 15),
          completedAt: DateTime(2026, 3, 2, 11, 45),
        ),
      ],
    ));
    await tester.pumpAndSettle();

    expect(_inTile('j1', find.text('Dibuat')), findsOneWidget);
    expect(_inTile('j1', find.text('Dijadwalkan')), findsOneWidget);
    expect(_inTile('j1', find.text('Mulai')), findsOneWidget);
    expect(find.text('01-03-2026 08:00'), findsOneWidget);
    // Muncul dua kali: stempel "Selesai" pada kartu entri, dan
    // "Servis terakhir" pada kartu unit yang diturunkan dari job selesai
    // terbaru karena unit ini tak punya last_service_date.
    expect(find.text('02-03-2026 11:45'), findsNWidgets(2));
    // Durasi mulai → selesai.
    expect(find.text('2 jam 30 menit'), findsOneWidget);
  });

  testWidgets('ringkasan foto & material tampil pada entri', (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(
      unit: _unit(),
      jobs: [
        _job(id: 'j1', type: 'service', status: JobStatus.selesai),
      ],
      extras: const {
        'j1': JobHistoryExtra(
          photosBefore: 2,
          photosAfter: 1,
          materialItems: 1,
          materialTotal: 350000,
          materialPending: 1,
        ),
      },
    ));
    await tester.pumpAndSettle();

    expect(find.text('2 sebelum • 1 sesudah'), findsOneWidget);
    expect(find.text('Material Rp 350.000'), findsOneWidget);
    expect(find.text('1 pengajuan menunggu'), findsOneWidget);
  });

  testWidgets('filter jenis pekerjaan menyaring entri', (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(
      unit: _unit(),
      jobs: [
        _job(id: 'j2', type: 'cuci', status: JobStatus.selesai),
        _job(id: 'j1', type: 'pemasangan', status: JobStatus.selesai),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('history-j1')), findsOneWidget);
    expect(find.byKey(const Key('history-j2')), findsOneWidget);

    // Ketuk chip di baris filter — bukan judul kartu yang teksnya sama.
    await tester.tap(find.descendant(
      of: find.byKey(const Key('history-filter')),
      matching: find.text('Cuci AC'),
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('history-j2')), findsOneWidget);
    expect(find.byKey(const Key('history-j1')), findsNothing);
    expect(find.text('1 dari 2'), findsOneWidget);
  });

  testWidgets('empty state saat unit belum pernah dikerjakan', (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(unit: _unit(), jobs: const []));
    await tester.pumpAndSettle();

    expect(find.text('Belum ada riwayat pekerjaan untuk unit ini.'),
        findsOneWidget);
    expect(find.text('-'), findsOneWidget); // servis terakhir kosong
  });

  testWidgets('jadwal servis lewat tanggal ditandai terlewat', (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(
      unit: _unit(nextService: DateTime(2020, 1, 5, 8, 0)),
      jobs: const [],
    ));
    await tester.pumpAndSettle();

    expect(find.text('05-01-2020 08:00 (terlewat)'), findsOneWidget);
  });

  testWidgets('unit belum termuat: layar tetap tampil dengan riwayat',
      (tester) async {
    _useTallViewport(tester);
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

  group('historySteps', () {
    test('hanya memuat stempel yang benar-benar tercatat', () {
      final steps = historySteps(_job(
        id: 'j',
        type: 'cuci',
        status: JobStatus.assigned,
        createdAt: DateTime(2026, 3, 2, 7, 0),
        scheduledDate: DateTime(2026, 3, 4, 10, 0),
      ));
      expect(steps.map((s) => s.label), ['Dibuat', 'Dijadwalkan']);
    });

    test('kosong bila tak ada stempel sama sekali', () {
      expect(
        historySteps(_job(id: 'j', type: 'cuci', status: JobStatus.assigned)),
        isEmpty,
      );
    });
  });

  group('jobDuration', () {
    test('null bila belum selesai', () {
      expect(
        jobDuration(_job(
          id: 'j',
          type: 'cuci',
          status: JobStatus.sedangDikerjakan,
          startedAt: DateTime(2026, 3, 2, 9, 0),
        )),
        isNull,
      );
    });

    test('selesai lebih awal dari mulai dianggap tak valid, bukan negatif', () {
      expect(
        jobDuration(_job(
          id: 'j',
          type: 'cuci',
          status: JobStatus.selesai,
          startedAt: DateTime(2026, 3, 2, 9, 0),
          completedAt: DateTime(2026, 3, 2, 8, 0),
        )),
        isNull,
      );
    });
  });

  group('formatDuration', () {
    test('memilih satuan sesuai besarnya', () {
      expect(formatDuration(const Duration(seconds: 30)),
          'Kurang dari 1 menit');
      expect(formatDuration(const Duration(minutes: 45)), '45 menit');
      expect(formatDuration(const Duration(hours: 2)), '2 jam');
      expect(formatDuration(const Duration(hours: 2, minutes: 30)),
          '2 jam 30 menit');
      expect(formatDuration(const Duration(days: 1)), '1 hari');
      expect(formatDuration(const Duration(days: 2, hours: 3)), '2 hari 3 jam');
    });
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
        historyTimeline(_job(
          id: 'j',
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
