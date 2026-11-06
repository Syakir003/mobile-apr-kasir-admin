import 'dart:async';

import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/job_finding.dart';
import 'package:epos_ac/data/models/material_request.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/job_detail_screen.dart';
import 'package:epos_ac/features/jobs/job_list_screen.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job({bool complaint = false}) => TechnicianJob(
      id: '1',
      orderId: 'o1',
      memberId: 'm1',
      unitId: 'u1',
      technicianId: 't1',
      type: 'perbaikan',
      status: JobStatus.sedangDikerjakan,
      startedAt: DateTime(2026, 11, 3, 9),
      memberName: 'Budi',
      unitBrand: 'Daikin',
      unitModel: 'SK1',
      unitBarcode: 'BC1',
      createdAt: DateTime(2026, 11, 3, 8),
      complaintOfJobId: complaint ? 'j0' : null,
      complaintOfCompletedAt: complaint ? DateTime(2026, 11, 1, 15) : null,
      complaintOfTechnicianName: complaint ? 'Rudi' : null,
    );

Widget _detail(TechnicianJob job) => ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => Stream.value(
            const AppUser(uid: 't1', email: 'e', displayName: 'Tek', role: UserRole.teknisi))),
        jobProvider.overrideWith((ref, id) => Future.value(job)),
        jobFindingsProvider.overrideWith((ref, id) => Future.value(const <JobFinding>[])),
        jobRequestsProvider.overrideWith((ref, id) => Future.value(const <MaterialRequest>[])),
        // Tanpa data tagihan (banner bayar tidak tampil), tidak memanggil API.
        jobPaymentInfoProvider.overrideWith((ref, id) => Completer<JobPaymentInfo>().future),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const JobDetailScreen(jobId: '1')),
    );

void main() {
  void tall(WidgetTester tester) {
    tester.view.physicalSize = const Size(1000, 4000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  test('mapper Nest: complaintOfJobId & complaintOf terbawa ke model', () {
    final job = TechnicianJob.fromMap('1', {
      'status': 'assigned',
      'complaint_of_job_id': 'j0',
      'complaint_of': {
        'id': 'j0',
        'completedAt': '2026-11-01T08:00:00.000Z',
        'technician': {'displayName': 'Rudi'},
      },
    });
    expect(job.isComplaint, isTrue);
    expect(job.complaintOfTechnicianName, 'Rudi');
    expect(job.complaintOfCompletedAt, isNotNull);
    expect(TechnicianJob.fromMap('2', {'status': 'assigned'}).isComplaint, isFalse);
  });

  testWidgets('job biasa: Kirim Temuan tampil, tanpa banner komplain', (tester) async {
    tall(tester);
    await tester.pumpWidget(_detail(_job()));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('complaint-banner')), findsNothing);
    await tester.scrollUntilVisible(find.byKey(const Key('send-findings-bar')), 400,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Kirim Temuan'), findsOneWidget);
  });

  testWidgets('job komplain: banner tampil, Kirim Temuan & teks harga jasa disembunyikan', (tester) async {
    tall(tester);
    await tester.pumpWidget(_detail(_job(complaint: true)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('complaint-banner')), findsOneWidget);
    expect(find.text('Job komplain - pengerjaan ulang'), findsOneWidget);
    expect(find.textContaining('oleh Rudi'), findsOneWidget);
    expect(find.byKey(const Key('send-findings-bar'), skipOffstage: false), findsNothing);
    expect(find.textContaining('Menunggu harga jasa', skipOffstage: false), findsNothing);
    // Tambah temuan tetap tersedia: inti pengerjaan ulang.
    expect(find.text('Tambah Temuan', skipOffstage: false), findsWidgets);
  });

  testWidgets('daftar job: lencana Komplain hanya pada job komplain', (tester) async {
    tall(tester);
    Widget card(TechnicianJob j) => MaterialApp(
        theme: AppTheme.light(), home: Scaffold(body: JobCard(job: j)));
    await tester.pumpWidget(card(_job(complaint: true)));
    expect(find.byKey(const Key('complaint-badge')), findsOneWidget);
    await tester.pumpWidget(card(_job()));
    expect(find.byKey(const Key('complaint-badge')), findsNothing);
  });
}
