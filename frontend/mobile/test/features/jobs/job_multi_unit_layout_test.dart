import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/job_finding.dart';
import 'package:epos_ac/data/models/material_request.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/job_detail_screen.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:epos_ac/features/pos/pos_providers.dart' show techniciansProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job(String id,
        {List<String> siblings = const [], JobStatus status = JobStatus.assigned}) =>
    TechnicianJob(
      id: id,
      orderId: 'o1',
      memberId: 'm1',
      unitId: 'u$id',
      technicianId: 't1',
      technicianIds: const ['t1'],
      type: 'cuci',
      status: status,
      memberName: 'Budi',
      unitBrand: 'Daikin',
      unitModel: 'SK$id',
      unitBarcode: 'BC$id',
      createdAt: DateTime(2026, 11, 3, 10, int.parse(id)),
      siblingIds: siblings,
    );

void main() {
  const teknisi = AppUser(uid: 't1', email: 'e', displayName: 'Tek', role: UserRole.teknisi);

  // Regresi: ExpansionTile bertanda PageStorageKey menyimpan status buka-tutup (bool) di bucket yang sama
  // dengan Scrollable milik TextField (double) -> TypeError dan kotak abu-abu di layar.
  testWidgets('banyak AC: ketik catatan dan buka-tutup section tidak memicu galat', (tester) async {
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => Stream.value(teknisi)),
        jobProvider.overrideWith((ref, id) => Future.value(_job(id, siblings: id == '1' ? ['2'] : ['1']))),
        jobFindingsProvider.overrideWith((ref, id) => Future.value(const <JobFinding>[])),
        jobRequestsProvider.overrideWith((ref, id) => Future.value(const <MaterialRequest>[])),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const JobDetailScreen(jobId: '1')),
    ));
    await tester.pumpAndSettle();

    final notes = find.byKey(const Key('job-notes')).first;
    expect(tester.getSize(notes).height, lessThan(200));

    await tester.enterText(notes, 'cek freon');
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Daikin SK1').first);
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Daikin SK1').first);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(tester.getSize(find.byKey(const Key('job-notes')).first).height, lessThan(200));
  });

  group('banyak AC: tugaskan teknisi dari detail order', () {
    Future<List<Map<String, dynamic>>> open(
      WidgetTester tester,
      UserRole role, {
      JobStatus first = JobStatus.assigned,
      JobStatus second = JobStatus.assigned,
    }) async {
      tester.view.physicalSize = const Size(1000, 6000);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      final sent = <Map<String, dynamic>>[];
      await tester.pumpWidget(ProviderScope(
        overrides: [
          currentUserProvider.overrideWith(
              (ref) => Stream.value(AppUser(uid: 'x', email: 'e', displayName: 'X', role: role))),
          jobProvider.overrideWith((ref, id) => Future.value(_job(id,
              siblings: id == '1' ? ['2'] : ['1'], status: id == '1' ? first : second))),
          jobFindingsProvider.overrideWith((ref, id) => Future.value(const <JobFinding>[])),
          jobRequestsProvider.overrideWith((ref, id) => Future.value(const <MaterialRequest>[])),
          techniciansProvider.overrideWith(
              (ref) => Stream.value([(uid: 't1', name: 'Andi'), (uid: 't2', name: 'Budi')])),
          technicianWorkloadProvider.overrideWith((ref) => Future.value(const <String, List<BusyJob>>{})),
          assignTechnicianCallerProvider.overrideWithValue((payload) async => sent.add(payload)),
        ],
        child: MaterialApp(theme: AppTheme.light(), home: const JobDetailScreen(jobId: '1')),
      ));
      await tester.pumpAndSettle();
      return sent;
    }

    Future<void> addBudiAndSave(WidgetTester tester) async {
      await tester.ensureVisible(find.byKey(const Key('tech-t2')));
      await tester.tap(find.byKey(const Key('tech-t2')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Simpan Penugasan'));
      await tester.tap(find.text('Simpan Penugasan'));
      await tester.pumpAndSettle();
    }

    testWidgets('admin: beberapa teknisi dipasang ke semua unit', (tester) async {
      final sent = await open(tester, UserRole.admin);
      expect(find.text('Tugaskan Teknisi'), findsOneWidget);
      expect(find.text('Berlaku untuk semua unit yang belum selesai.'), findsOneWidget);
      await addBudiAndSave(tester);
      expect(sent.single, {'jobId': '1', 'technicianIds': ['t1', 't2'], 'allInOrder': true});
    });

    testWidgets('unit pertama sudah selesai: dikirim lewat unit yang masih bisa dialihkan', (tester) async {
      final sent = await open(tester, UserRole.admin, first: JobStatus.selesai);
      await addBudiAndSave(tester);
      expect(sent.single['jobId'], '2');
    });

    testWidgets('kasir juga melihat panel', (tester) async {
      await open(tester, UserRole.kasir);
      expect(find.text('Tugaskan Teknisi'), findsOneWidget);
    });

    testWidgets('teknisi tidak melihat panel', (tester) async {
      await open(tester, UserRole.teknisi);
      expect(find.text('Tugaskan Teknisi'), findsNothing);
    });

    testWidgets('semua unit sudah dikerjakan: tanpa panel, sama seperti 1 AC', (tester) async {
      await open(tester, UserRole.admin,
          first: JobStatus.sedangDikerjakan, second: JobStatus.sedangDikerjakan);
      expect(find.text('Tugaskan Teknisi'), findsNothing);
    });
  });
}
