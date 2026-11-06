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

TechnicianJob _job(String id, {List<String> siblings = const []}) => TechnicianJob(
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
}
