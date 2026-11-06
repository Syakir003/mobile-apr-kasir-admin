import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/data/repositories/job_repository.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:epos_ac/features/jobs/teknisi_dashboard_sections.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

final _today = DateTime.now();
String _iso(DateTime d) => DateTime(d.year, d.month, d.day, 9).toIso8601String();

TechnicianJob _job(String id,
        {String orderId = 'o1', String status = 'assigned', DateTime? on, String name = 'Bu Sari', String phone = '+6285512345678'}) =>
    TechnicianJob.fromMap(id, technicianJobRowFromNest({
      'orderId': orderId,
      'memberId': 'm1',
      'type': 'cuci',
      'status': status,
      'scheduledDate': on == null ? null : _iso(on),
      'member': {'name': name, 'phone': phone, 'address': 'Jl. Mawar 12'},
    }));

void main() {
  group('nextJob', () {
    test('yang sedang dikerjakan didahulukan', () {
      final j = nextJob([_job('a', on: _today), _job('b', status: 'sedang_dikerjakan')]);
      expect(j?.id, 'b');
    });

    test('lalu ditugaskan dengan jadwal paling awal; tanpa jadwal paling akhir; review diabaikan', () {
      final j = nextJob([
        _job('none'),
        _job('besok', on: _today.add(const Duration(days: 1))),
        _job('telat', on: _today.subtract(const Duration(days: 2))),
        _job('review', status: 'menunggu_review', on: _today.subtract(const Duration(days: 5))),
      ]);
      expect(j?.id, 'telat');
      expect(nextJob([_job('r', status: 'menunggu_review')]), isNull);
    });
  });

  test('filterJobs per hari dan status', () {
    final jobs = [_job('a', on: _today), _job('b', on: _today, status: 'sedang_dikerjakan'), _job('c')];
    expect(filterJobs(jobs, day: _today).map((j) => j.id), ['a', 'b']);
    expect(filterJobs(jobs, status: JobStatus.assigned).map((j) => j.id), ['a', 'c']);
    expect(filterJobs(jobs, day: _today, status: JobStatus.sedangDikerjakan).map((j) => j.id), ['b']);
  });

  test('waUriFor menormalkan nomor, kosong = null', () {
    expect(waUriFor('+62 855-1234-5678').toString(), 'https://wa.me/6285512345678');
    expect(waUriFor('085512345678').toString(), 'https://wa.me/6285512345678');
    expect(waUriFor('-'), isNull);
  });

  test('scheduleLabel', () {
    final now = DateTime(2026, 11, 5, 10);
    expect(scheduleLabel(DateTime(2026, 11, 5), now), 'Hari ini');
    expect(scheduleLabel(DateTime(2026, 11, 6), now), 'Besok');
    expect(scheduleLabel(DateTime(2026, 11, 3), now), 'Terlambat 2 hari');
    expect(scheduleLabel(null, now), 'Belum dijadwalkan');
  });

  group('TeknisiDashboard', () {
    Future<void> pump(WidgetTester tester, List<TechnicianJob> jobs, {double width = 1080}) async {
      tester.view.physicalSize = Size(width, 2400);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(ProviderScope(
        overrides: [
          currentUserProvider.overrideWith((ref) => Stream.value(
              const AppUser(uid: 't', email: 't@x.id', displayName: 'Imam Safi', role: UserRole.teknisi))),
          jobQueueProvider.overrideWith((ref) async => jobs),
          jobHistoryProvider.overrideWith((ref, page) async => (items: const <TechnicianJob>[], total: 7, totalPages: 1)),
        ],
        child: const MaterialApp(home: Scaffold(body: SingleChildScrollView(child: TeknisiDashboard()))),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('sapaan, ringkasan, dan kartu Kerjakan Sekarang dengan aksi lapangan', (tester) async {
      await pump(tester, [_job('a', on: _today), _job('b', orderId: 'o2', on: _today.add(const Duration(days: 2)), name: 'Pak Joko')]);

      expect(find.textContaining('Imam'), findsWidgets);
      expect(find.text('1 job hari ini'), findsOneWidget);
      expect(find.text('7 selesai'), findsOneWidget);
      final card = find.byKey(const Key('next-job-card'));
      expect(find.descendant(of: card, matching: find.text('Bu Sari')), findsOneWidget);
      expect(find.byKey(const Key('next-job-maps')), findsOneWidget);
      expect(find.byKey(const Key('next-job-call')), findsOneWidget);
      expect(find.byKey(const Key('next-job-wa')), findsOneWidget);
    });

    testWidgets('ketuk hari dan chip status memfilter daftar', (tester) async {
      final lusa = _today.add(const Duration(days: 2));
      await pump(tester, [
        _job('a', on: _today),
        _job('b', orderId: 'o2', on: lusa, name: 'Pak Joko'),
        _job('c', orderId: 'o3', status: 'sedang_dikerjakan', name: 'Bu Rina'),
      ]);
      expect(find.text('Semua Job Aktif'), findsOneWidget);

      await tester.tap(find.byKey(Key('day-${lusa.day}')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Pak Joko'), findsOneWidget);
      expect(find.textContaining('Bu Sari'), findsNothing);

      // Ketuk lagi = kembali ke semua hari; lalu filter status Dikerjakan.
      await tester.tap(find.byKey(Key('day-${lusa.day}')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('status-sedang_dikerjakan')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Pak Joko'), findsNothing);
      expect(find.textContaining('Bu Rina'), findsWidgets);
    });

    testWidgets('tanpa job aktif: pesan santai, tanpa kartu Kerjakan Sekarang', (tester) async {
      await pump(tester, const []);
      expect(find.byKey(const Key('next-job-card')), findsNothing);
      expect(find.textContaining('Tidak ada job yang perlu dikerjakan'), findsOneWidget);
    });

    testWidgets('HP kecil (360 dp): tidak ada yang meluap', (tester) async {
      await pump(
        tester,
        [
          _job('a', status: 'sedang_dikerjakan', name: 'Ibu Sri Wahyuningsih Rahayu'),
          _job('b', orderId: 'o2', on: _today.subtract(const Duration(days: 3))),
        ],
        width: 900,
      );
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('next-job-card')), findsOneWidget);
    });
  });
}
