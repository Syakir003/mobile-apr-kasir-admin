import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/job_list_screen.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:epos_ac/features/notifications/notifications_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job({
  required String id,
  required JobStatus status,
  String member = 'Budi',
  String brand = 'LG',
  String model = 'Dualcool',
  String technician = '',
}) {
  return TechnicianJob(
    id: id,
    orderId: 'o1',
    memberId: 'm1',
    unitId: 'u1',
    technicianId: 't1',
    type: 'pemasangan',
    status: status,
    memberName: member,
    unitBrand: brand,
    unitModel: model,
    technicianName: technician,
  );
}

Widget _wrap({required AppUser user, required List<TechnicianJob> jobs}) {
  return ProviderScope(
    overrides: [
      currentUserProvider.overrideWith((ref) => Stream.value(user)),
      jobsForCurrentUserProvider.overrideWith((ref) => Future.value(jobs)),
      notificationsStreamProvider.overrideWith((ref) => Stream.value(const [])),
    ],
    child: const MaterialApp(home: JobListScreen()),
  );
}

void main() {
  const teknisi =
      AppUser(uid: 't1', email: 'e', displayName: 'Tek', role: UserRole.teknisi);
  const admin =
      AppUser(uid: 'a', email: 'e', displayName: 'Adm', role: UserRole.admin);

  testWidgets('teknisi: judul "Job Saya" & hanya job aktif yang tampil default',
      (tester) async {
    await tester.pumpWidget(_wrap(
      user: teknisi,
      jobs: [
        _job(id: 'j1', status: JobStatus.assigned, brand: 'LG', model: 'A'),
        _job(id: 'j2', status: JobStatus.selesai, brand: 'Panasonic', model: 'B'),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.text('Job Saya'), findsOneWidget);
    expect(find.text('LG A'), findsOneWidget); // aktif
    expect(find.text('Panasonic B'), findsNothing); // selesai disembunyikan
  });

  testWidgets('teknisi: tab Selesai menampilkan job selesai', (tester) async {
    await tester.pumpWidget(_wrap(
      user: teknisi,
      jobs: [
        _job(id: 'j1', status: JobStatus.assigned, brand: 'LG', model: 'A'),
        _job(id: 'j2', status: JobStatus.selesai, brand: 'Panasonic', model: 'B'),
      ],
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Selesai'));
    await tester.pumpAndSettle();

    expect(find.text('Panasonic B'), findsOneWidget);
    expect(find.text('LG A'), findsNothing);
  });

  testWidgets('admin: judul "Job Teknisi" & menampilkan nama teknisi',
      (tester) async {
    await tester.pumpWidget(_wrap(
      user: admin,
      jobs: [
        _job(id: 'j1', status: JobStatus.assigned, technician: 'Andi'),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.text('Job Teknisi'), findsOneWidget);
    expect(find.text('Teknisi: Andi'), findsOneWidget);
  });

  testWidgets('empty state saat tak ada job aktif', (tester) async {
    await tester.pumpWidget(_wrap(user: teknisi, jobs: const []));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada job aktif.'), findsOneWidget);
  });
}
