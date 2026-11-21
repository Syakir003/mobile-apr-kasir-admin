import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/job_finding.dart';
import 'package:epos_ac/data/models/job_photo.dart' show PhotoKind;
import 'package:epos_ac/data/models/material_request.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/job_detail_screen.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job({
  JobStatus status = JobStatus.assigned,
  String? unitId = 'u1',
  bool waived = false,
  String type = 'cuci',
}) =>
    TechnicianJob(
      id: '1',
      orderId: 'o1',
      memberId: 'm1',
      unitId: unitId,
      technicianId: 't1',
      type: type,
      status: status,
      memberName: 'Budi',
      unitBrand: unitId == null ? '' : 'Daikin',
      unitModel: unitId == null ? '' : 'SK1',
      unitBarcode: unitId == null ? '' : 'BC1',
      startScanWaived: waived,
    );

const _before = JobFindingPhoto(id: 'p1', kind: PhotoKind.sebelum, path: '/uploads/a.jpg');

Widget _app(TechnicianJob job, {List<JobFinding> findings = const []}) => ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => Stream.value(
            const AppUser(uid: 't1', email: 'e', displayName: 'Tek', role: UserRole.teknisi))),
        jobProvider.overrideWith((ref, id) => Future.value(job)),
        jobFindingsProvider.overrideWith((ref, id) => Future.value(findings)),
        jobRequestsProvider.overrideWith((ref, id) => Future.value(const <MaterialRequest>[])),
        jobPaymentInfoProvider.overrideWith((ref, id) => Future.value(jobPaymentInfoFromJobDetail(const {}))),
        signedPhotoUrlProvider.overrideWith((ref, path) => Future<String>.error('offline')),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const JobDetailScreen(jobId: '1')),
    );

void main() {
  void tall(WidgetTester tester) {
    tester.view.physicalSize = const Size(1000, 4000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  group('model', () {
    test('scanDone: sudah dimulai, atau Ditugaskan + unit terisi + scan diakui (klaim slot)', () {
      expect(_job().scanDone, isFalse);
      expect(_job(waived: true).scanDone, isTrue);
      expect(_job(status: JobStatus.sedangDikerjakan).scanDone, isFalse); // scanned butuh startedAt
      // Slot kosong tidak pernah dianggap discan walau flag ada.
      expect(_job(unitId: null, waived: true).scanDone, isFalse);
    });

    test('isSlot: tanpa unit kecuali pemasangan', () {
      expect(_job(unitId: null).isSlot, isTrue);
      expect(_job().isSlot, isFalse);
      expect(_job(unitId: null, type: 'pemasangan').isSlot, isFalse);
    });

    test('startScanWaived dibaca dari detail job', () {
      final j = TechnicianJob.fromMap('1', {'status': 'assigned', 'unit_id': 'u', 'start_scan_waived': true});
      expect(j.startScanWaived, isTrue);
      expect(TechnicianJob.fromMap('1', {'status': 'assigned'}).startScanWaived, isFalse);
    });
  });

  group('scanReminderText', () {
    test('versi foto dulu: awalan jumlah unit di banyak AC, dan petunjuk slot', () {
      final t = scanReminderText(unscanned: 3, slots: 1, withoutPhoto: 2, multi: true);
      expect(t.title, 'Kirim foto sebelum pengerjaan dulu');
      expect(t.body, startsWith('2 unit AC belum punya foto sebelum. '));
      expect(t.body, contains('Unit yang belum diketahui discan dulu'));
      expect(scanReminderText(unscanned: 1, slots: 0, withoutPhoto: 1, multi: false).body,
          startsWith('Silakan kirim foto sebelum'));
    });

    test('versi scan: satu unit, banyak unit, dan slot', () {
      final one = scanReminderText(unscanned: 1, slots: 0, withoutPhoto: 0, multi: false);
      expect(one.title, 'Silakan scan unitnya terlebih dahulu');
      expect(one.body, startsWith('Unit AC pada pekerjaan ini belum discan.'));
      expect(one.body, contains('foto sesudah baru bisa diunggah setelah Mulai Job'));
      expect(scanReminderText(unscanned: 3, slots: 0, withoutPhoto: 0, multi: true).body,
          startsWith('3 unit AC pada pekerjaan ini belum discan.'));
      expect(scanReminderText(unscanned: 2, slots: 2, withoutPhoto: 0, multi: true).body,
          contains('unitnya otomatis masuk ke pekerjaan ini'));
    });
  });

  group('detail job teknisi', () {
    testWidgets('belum scan + belum ada foto sebelum: popup foto dulu, foto sesudah terkunci', (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(), findings: const [JobFinding(id: 'f1', title: 'Bocor')]));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('scan-reminder')), findsOneWidget);
      expect(find.text('Kirim foto sebelum pengerjaan dulu'), findsOneWidget);
      await tester.tap(find.text('Mengerti'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('scan-reminder')), findsNothing);

      // Foto sebelum boleh (ada tombol tambah), foto sesudah diganti petunjuk.
      expect(find.text('Bisa diunggah setelah Mulai Job (scan unit dulu).'), findsOneWidget);
      expect(find.byKey(const ValueKey('after-locked-sesudah')), findsOneWidget);
    });

    testWidgets('sudah ada foto sebelum: popup versi scan; Kirim Temuan membuka sheet scan, tidak mengirim',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(),
          findings: const [JobFinding(id: 'f1', title: 'Bocor', photos: [_before])]));
      await tester.pumpAndSettle();

      expect(find.text('Silakan scan unitnya terlebih dahulu'), findsOneWidget);
      await tester.tap(find.text('Mengerti'));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(find.byKey(const Key('send-findings')), 300,
          scrollable: find.byType(Scrollable).first);
      await tester.tap(find.byKey(const Key('send-findings')));
      await tester.pumpAndSettle();

      expect(find.text('Scan unit & Mulai Job dulu'), findsOneWidget);
      expect(find.byKey(const Key('need-scan-start')), findsOneWidget);
      await tester.tap(find.byKey(const Key('need-scan-later')));
      await tester.pumpAndSettle();
      expect(find.text('Scan unit & Mulai Job dulu'), findsNothing);
    });

    testWidgets('scan sudah diakui (klaim slot): tanpa popup pengingat', (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(waived: true),
          findings: const [JobFinding(id: 'f1', title: 'Bocor', photos: [_before])]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('scan-reminder')), findsNothing);
    });

    testWidgets('slot kosong: kartu pengganti, tanpa temuan, dan tombol Scan Unit AC', (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(unitId: null)));
      await tester.pumpAndSettle();
      expect(find.text('Silakan scan unitnya terlebih dahulu'), findsOneWidget);
      await tester.tap(find.text('Mengerti'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('slot-card')), findsOneWidget);
      expect(find.textContaining('menunggu discan'), findsWidgets);
      expect(find.byKey(const Key('add-finding')), findsNothing);
      expect(find.text('Scan Unit AC'), findsOneWidget);
      expect(find.text('Mulai Pekerjaan'), findsNothing);
    });

    testWidgets('sedang dikerjakan: foto sesudah terbuka, tanpa popup', (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(status: JobStatus.sedangDikerjakan),
          findings: const [JobFinding(id: 'f1', title: 'Bocor', photos: [_before])]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('scan-reminder')), findsNothing);
      expect(find.byKey(const ValueKey('after-locked-sesudah')), findsNothing);
    });
  });
  group('bar aksi bawah (teknisi)', () {
    Finder inBar(Finder f) => find.descendant(of: find.byKey(const Key('job-action-bar')), matching: f);

    testWidgets('Ditugaskan tanpa foto sebelum: tombol Mulai di bar, nonaktif, dengan alasan', (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(), findings: const [JobFinding(id: 'f1', title: 'Bocor')]));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Mengerti'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('job-action-bar')), findsOneWidget);
      expect(inBar(find.text('Mulai Pekerjaan')), findsOneWidget);
      expect(inBar(find.textContaining('foto SEBELUM')), findsOneWidget);
      expect(tester.widget<FilledButton>(inBar(find.byType(FilledButton))).onPressed, isNull);
      // Tidak digandakan di isi halaman.
      expect(find.text('Mulai Pekerjaan'), findsOneWidget);
    });

    testWidgets('sudah ada foto sebelum: tombol Mulai aktif tanpa alasan', (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(waived: true),
          findings: const [JobFinding(id: 'f1', title: 'Bocor', photos: [_before])]));
      await tester.pumpAndSettle();
      expect(tester.widget<FilledButton>(inBar(find.byType(FilledButton))).onPressed, isNotNull);
      expect(inBar(find.byType(Text)).evaluate().length, 1); // hanya label tombol
    });

    testWidgets('slot: bar berisi Scan Unit AC', (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(unitId: null)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Mengerti'));
      await tester.pumpAndSettle();
      expect(inBar(find.text('Scan Unit AC')), findsOneWidget);
    });

    testWidgets('sedang dikerjakan: bar berisi Ajukan Selesai', (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(status: JobStatus.sedangDikerjakan),
          findings: const [JobFinding(id: 'f1', title: 'Bocor', photos: [_before])]));
      await tester.pumpAndSettle();
      expect(inBar(find.text('Ajukan Selesai')), findsOneWidget);
    });

    testWidgets('selesai: tanpa bar', (tester) async {
      tall(tester);
      await tester.pumpWidget(_app(_job(status: JobStatus.selesai)));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('job-action-bar')), findsNothing);
    });
  });
}
