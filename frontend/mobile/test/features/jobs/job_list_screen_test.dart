import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/job_distance.dart';
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
  String orderId = 'o1',
}) {
  return TechnicianJob(
    id: id,
    orderId: orderId,
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

  testWidgets('teknisi: tanpa tab Selesai (ada di layar Riwayat), job selesai tak tampil', (tester) async {
    await tester.pumpWidget(_wrap(
      user: teknisi,
      jobs: [
        _job(id: 'j1', status: JobStatus.assigned, brand: 'LG', model: 'A'),
        _job(id: 'j2', status: JobStatus.selesai, brand: 'Panasonic', model: 'B'),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.text('Selesai'), findsNothing);
    expect(find.text('LG A'), findsOneWidget);
    expect(find.text('Panasonic B'), findsNothing);
  });

  testWidgets('admin: tab Selesai menampilkan job selesai', (tester) async {
    await tester.pumpWidget(_wrap(
      user: admin,
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

  testWidgets('pencarian menyaring job; tak ada yang cocok -> Reset filter', (tester) async {
    await tester.pumpWidget(_wrap(
      user: admin,
      jobs: [
        _job(id: 'j1', status: JobStatus.assigned, member: 'Budi', orderId: 'o1'),
        _job(id: 'j2', status: JobStatus.assigned, member: 'Siti', orderId: 'o2'),
      ],
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('job-search')), 'siti');
    await tester.pumpAndSettle();
    expect(find.textContaining('Siti'), findsOneWidget);
    expect(find.textContaining('Budi'), findsNothing);

    await tester.enterText(find.byKey(const Key('job-search')), 'tidak-ada');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('job-reset-filter')), findsOneWidget);
    await tester.tap(find.byKey(const Key('job-reset-filter')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Budi'), findsOneWidget);
    expect(find.textContaining('Siti'), findsOneWidget);
  });

  testWidgets('Terdekat dari Toko: urut dekat ke jauh, badge km, dan yang gagal di bawah', (tester) async {
    final asked = <List<String>>[];
    await tester.pumpWidget(ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => Stream.value(admin)),
        jobsForCurrentUserProvider.overrideWith((ref) => Future.value([
              _job(id: 'jauh', status: JobStatus.assigned, member: 'Jauh', orderId: 'o1'),
              _job(id: 'gagal', status: JobStatus.assigned, member: 'Gagal', orderId: 'o2'),
              _job(id: 'dekat', status: JobStatus.assigned, member: 'Dekat', orderId: 'o3'),
            ])),
        notificationsStreamProvider.overrideWith((ref) => Stream.value(const [])),
        jobDistancesCallerProvider.overrideWithValue((ids) async {
          asked.add(ids);
          return JobDistancesResult.fromJson({
            'pending': 0,
            'items': [
              {'jobId': 'jauh', 'km': 12.0, 'state': 'ok', 'precision': 'titik'},
              {'jobId': 'gagal', 'km': null, 'state': 'unknown', 'reason': 'incomplete'},
              {'jobId': 'dekat', 'km': 1.2, 'state': 'ok', 'precision': 'wilayah'},
            ],
          });
        }),
      ],
      child: const MaterialApp(home: JobListScreen()),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('job-sort-nearest')));
    await tester.pumpAndSettle();

    expect(asked, [
      ['jauh', 'gagal', 'dekat'],
    ]);
    expect(find.text('± 1,2 km dari toko · pusat kota/kabupaten'), findsOneWidget);
    expect(find.text('± 12 km dari toko'), findsOneWidget);
    expect(find.textContaining('alamat kurang lengkap'), findsWidgets); // badge + ringkasan
    expect(find.byKey(const Key('fix-address')), findsOneWidget);

    double top(String member) => tester.getTopLeft(find.textContaining(member).first).dy;
    expect(top('Dekat'), lessThan(top('Jauh')));
    expect(top('Jauh'), lessThan(top('Gagal')));
  });

  testWidgets('teknisi tidak punya tombol cetak daftar; admin punya', (tester) async {
    await tester.pumpWidget(_wrap(user: teknisi, jobs: [_job(id: 'j1', status: JobStatus.assigned)]));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('job-print-list')), findsNothing);

    await tester.pumpWidget(const SizedBox()); // buang ProviderScope lama supaya peran baru terbaca
    await tester.pumpWidget(_wrap(user: admin, jobs: [_job(id: 'j1', status: JobStatus.assigned)]));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('job-print-list')), findsOneWidget);
  });

  testWidgets('empty state saat tak ada job aktif', (tester) async {
    await tester.pumpWidget(_wrap(user: teknisi, jobs: const []));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada job aktif.'), findsOneWidget);
  });
}
