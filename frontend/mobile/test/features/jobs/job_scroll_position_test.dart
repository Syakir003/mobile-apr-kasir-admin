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
import 'package:go_router/go_router.dart';

// Laporan teknisi: layar detail job tiba-tiba berada di paling bawah, (1) saat dibuka dari dashboard,
// (2) sesudah mengisi data lalu membuka kamera/scan. Memakai router asli aplikasi.

TechnicianJob _job(String id) => TechnicianJob(
      id: id,
      orderId: 'o$id',
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
      notes: 'diagnosa job $id',
      createdAt: DateTime(2026, 11, 3, 8),
    );

Future<GoRouter> _app(WidgetTester tester) async {
  tester.view.physicalSize = const Size(400, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final container = ProviderContainer(overrides: [
    currentUserProvider.overrideWith((ref) => Stream.value(
        const AppUser(uid: 't1', email: 'e', displayName: 'Tek', role: UserRole.teknisi))),
    jobProvider.overrideWith((ref, id) => Future.value(_job(id))),
    jobsForCurrentUserProvider.overrideWith((ref) => Future.value([_job('1')])),
    jobQueueProvider.overrideWith((ref) => Future.value([_job('1')])),
    jobFindingsProvider.overrideWith((ref, id) => Future.value(const <JobFinding>[])),
    jobRequestsProvider.overrideWith((ref, id) => Future.value(const <MaterialRequest>[])),
    jobPaymentInfoProvider.overrideWith((ref, id) => Completer<JobPaymentInfo>().future),
  ]);
  addTearDown(container.dispose);
  final router = container.read(appRouterProvider);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: MaterialApp.router(theme: AppTheme.light(), routerConfig: router),
  ));
  await _settle(tester);
  return router;
}

// Dashboard asli punya animasi yang tidak pernah diam; pump beberapa kali saja.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  tester.takeException(); // data dashboard memang tidak bisa dimuat di tes
}

ScrollPosition _pagePosition(WidgetTester tester) => tester
    .state<ScrollableState>(find
        .descendant(of: find.byType(JobDetailScreen), matching: find.byType(Scrollable))
        .first)
    .position;

void main() {
  testWidgets('buka job lain dari dashboard: mulai dari atas & isinya milik job itu', (tester) async {
    final router = await _app(tester);
    router.go('/jobs/1');
    await _settle(tester);
    _pagePosition(tester).jumpTo(_pagePosition(tester).maxScrollExtent);
    await _settle(tester);

    unawaited(router.push('/')); // menu bawah: Dashboard
    await _settle(tester);
    router.go('/jobs/2'); // ketuk kartu job di dashboard
    await _settle(tester);

    expect(_pagePosition(tester).pixels, 0);
    expect(find.text('diagnosa job 1', skipOffstage: false), findsNothing);
  });

  testWidgets('job yang sama diketuk lagi dari daftar: mulai dari atas', (tester) async {
    final router = await _app(tester);
    router.go('/jobs/1');
    await _settle(tester);
    _pagePosition(tester).jumpTo(_pagePosition(tester).maxScrollExtent);
    await _settle(tester);

    unawaited(router.push('/jobs')); // menu bawah: Job Saya
    await _settle(tester);
    await tester.tap(find.byType(JobQueueCard).first);
    await _settle(tester);

    expect(_pagePosition(tester).pixels, 0);
  });

  testWidgets('dialog dengan autofocus tetap mendapat fokus; sesudah ditutup kolom lama tidak', (tester) async {
    final old = FocusNode();
    final inDialog = FocusNode();
    addTearDown(old.dispose);
    addTearDown(inDialog.dispose);
    await tester.pumpWidget(MaterialApp(
      navigatorObservers: [UnfocusOnPush()],
      home: Scaffold(body: TextField(focusNode: old)),
    ));
    await tester.tap(find.byType(TextField));
    await tester.pumpAndSettle();
    expect(old.hasFocus, isTrue);

    unawaited(showDialog<void>(
      context: tester.element(find.byType(Scaffold)),
      builder: (_) => AlertDialog(content: TextField(focusNode: inDialog, autofocus: true)),
    ));
    await tester.pumpAndSettle();
    expect(inDialog.hasFocus, isTrue);

    Navigator.of(tester.element(find.byType(AlertDialog))).pop();
    await tester.pumpAndSettle();
    expect(old.hasFocus, isFalse);
  });

  testWidgets('sesudah mengisi kolom lalu buka & tutup panel: posisi tidak melompat', (tester) async {
    final router = await _app(tester);
    router.go('/jobs/1');
    await _settle(tester);

    // Isi kolom paling bawah (Keterangan); keyboard ditutup tapi kolom masih fokus.
    final position = _pagePosition(tester);
    position.jumpTo(position.maxScrollExtent);
    await _settle(tester);
    await tester.enterText(find.byType(TextField).last, 'freon kurang');
    await _settle(tester);

    position.jumpTo(0);
    await _settle(tester);
    final addButton = find.text('Tambah Temuan');
    await tester.scrollUntilVisible(addButton, 100,
        scrollable: find
            .descendant(of: find.byType(JobDetailScreen), matching: find.byType(Scrollable))
            .first);
    await _settle(tester);
    final before = position.pixels;
    await tester.tap(addButton);
    await _settle(tester);
    Navigator.of(tester.element(find.byType(BottomSheet))).pop();
    await _settle(tester);

    expect(position.pixels, closeTo(before, 1));
  });
}
