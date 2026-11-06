import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/job_finding.dart';
import 'package:epos_ac/data/models/material_request.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/job_detail_screen.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Servis banyak AC (2 unit, satu order). [technicianNote] = Keterangan teknisi di level order.
TechnicianJob _job(String id, {String? technicianNote}) => TechnicianJob(
      id: id,
      orderId: 'o1',
      memberId: 'm1',
      unitId: 'u$id',
      technicianId: 't1',
      type: 'cuci',
      status: JobStatus.assigned,
      memberName: 'Budi',
      unitBrand: 'Daikin',
      unitModel: 'SK$id',
      unitBarcode: 'BC$id',
      createdAt: DateTime(2026, 11, 3, 10, int.parse(id)),
      siblingIds: id == '1' ? ['2'] : ['1'],
      technicianNote: technicianNote,
    );

Widget _app(AppUser user, {String? technicianNote}) => ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => Stream.value(user)),
        jobProvider.overrideWith((ref, id) => Future.value(_job(id, technicianNote: technicianNote))),
        jobFindingsProvider.overrideWith((ref, id) => Future.value(const <JobFinding>[])),
        jobRequestsProvider.overrideWith((ref, id) => Future.value(const <MaterialRequest>[])),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const JobDetailScreen(jobId: '1')),
    );

void main() {
  const teknisi = AppUser(uid: 't1', email: 'e', displayName: 'Tek', role: UserRole.teknisi);
  const admin = AppUser(uid: 'a1', email: 'a', displayName: 'Adm', role: UserRole.admin);

  void tall(WidgetTester tester) {
    tester.view.physicalSize = const Size(1000, 4000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  // ListView membangun item secara lazy: gulir sampai kartu Keterangan terbangun.
  Future<void> toKeterangan(WidgetTester tester) => tester.scrollUntilVisible(
        find.byKey(const Key('job-keterangan')),
        400,
        scrollable: find.byType(Scrollable).first,
      );

  testWidgets('teknisi (job aktif): kartu Keterangan tampil, terpisah dari Diagnosa, tombol simpan aktif hanya saat berubah',
      (tester) async {
    tall(tester);
    await tester.pumpWidget(_app(teknisi, technicianNote: 'Cuci 2 unit, cash 75 ribu'));
    await tester.pumpAndSettle();

    await toKeterangan(tester);

    // Diagnosa per unit tetap ada (satu per unit) dan Keterangan hanya satu untuk seluruh order.
    expect(find.byKey(const Key('job-notes'), skipOffstage: false), findsNWidgets(2));
    expect(find.byKey(const Key('job-keterangan')), findsOneWidget);
    expect(find.text('Keterangan'), findsOneWidget);

    // Nilai awal dari server.
    final field = tester.widget<TextField>(find.byKey(const Key('job-keterangan')));
    expect(field.controller!.text, 'Cuci 2 unit, cash 75 ribu');

    OutlinedButton saveBtn() => tester.widget<OutlinedButton>(find.byKey(const Key('save-keterangan')));
    expect(saveBtn().onPressed, isNull); // belum berubah

    await tester.enterText(find.byKey(const Key('job-keterangan')), 'Pelanggan minta penawaran kapasitor');
    await tester.pump();
    expect(saveBtn().onPressed, isNotNull);

    // Kembali ke isi semula -> tidak ada yang perlu disimpan.
    await tester.enterText(find.byKey(const Key('job-keterangan')), 'Cuci 2 unit, cash 75 ribu');
    await tester.pump();
    expect(saveBtn().onPressed, isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('teknisi tanpa Keterangan: kartu tetap tampil (kosong) supaya bisa diisi', (tester) async {
    tall(tester);
    await tester.pumpWidget(_app(teknisi));
    await tester.pumpAndSettle();
    await toKeterangan(tester);

    expect(find.byKey(const Key('job-keterangan')), findsOneWidget);
    expect(tester.widget<OutlinedButton>(find.byKey(const Key('save-keterangan'))).onPressed, isNull);
  });

  testWidgets('admin: Keterangan hanya dibaca (tanpa kolom isian) dan disembunyikan bila kosong', (tester) async {
    tall(tester);
    await tester.pumpWidget(_app(admin, technicianNote: 'Cuci 2 unit, cash 75 ribu'));
    await tester.pumpAndSettle();

    expect(find.text('Keterangan Teknisi'), findsOneWidget);
    expect(find.text('Cuci 2 unit, cash 75 ribu'), findsOneWidget);
    expect(find.byKey(const Key('job-keterangan')), findsNothing);
    expect(find.byKey(const Key('save-keterangan')), findsNothing);
  });

  testWidgets('admin tanpa Keterangan: kartu tidak tampil', (tester) async {
    tall(tester);
    await tester.pumpWidget(_app(admin));
    await tester.pumpAndSettle();
    expect(find.text('Keterangan Teknisi'), findsNothing);
    expect(find.byKey(const Key('job-keterangan')), findsNothing);
  });
}
