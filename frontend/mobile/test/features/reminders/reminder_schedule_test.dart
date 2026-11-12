import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/features/reminders/reminder_schedule_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// "Sekarang" tetap: 10 Nov 2026 siang WIB (UTC+7).
final _now = DateTime.utc(2026, 11, 10, 5, 0);

Map<String, dynamic> _unit(String id, {String status = 'segera', String? next, bool enabled = true, bool job = false, String unitStatus = 'aktif'}) => {
      'id': id,
      'label': 'Daikin 1 PK',
      'roomLocation': 'Kamar',
      'member': {'id': 'm1', 'name': 'Budi', 'phone': '08', 'waOptOut': false},
      'lastServiceDate': '2026-05-01T00:00:00.000Z',
      'serviceIntervalDays': 180,
      'nextServiceDate': next,
      'reminderEnabled': enabled,
      'unitStatus': unitStatus,
      'status': status,
      'adaJobBerjalan': job,
      'lastWa': null,
    };

void main() {
  group('scheduleLabel / daysUntil (hari kalender WIB)', () {
    test('lewat, hari ini, dan ke depan', () {
      expect(scheduleLabel('terlambat', '2026-10-21T00:00:00.000Z', now: _now), 'Terlambat 20 hari');
      expect(scheduleLabel('segera', '2026-11-10T01:00:00.000Z', now: _now), 'Jatuh tempo hari ini');
      expect(scheduleLabel('segera', '2026-11-13T00:00:00.000Z', now: _now), '3 hari lagi');
    });

    test('batas hari mengikuti WIB, bukan UTC', () {
      // 17:30 UTC tgl 9 = 00:30 WIB tgl 10 -> hari ini
      expect(daysUntil('2026-11-09T17:30:00.000Z', now: _now), 0);
    });

    test('status tanpa tanggal memakai label bawaan', () {
      expect(scheduleLabel('siklus_kosong', null, now: _now), 'Siklus belum diisi');
      expect(scheduleLabel('mati', '2026-11-20T00:00:00.000Z', now: _now), 'Pengingat mati');
    });
  });

  test('dueUnitIds: hanya aktif, menyala, tanpa job, jatuh tempo <= hari ini + 3', () {
    final units = [
      ScheduleUnit(_unit('a', next: '2026-11-12T00:00:00.000Z')), // 2 hari -> due
      ScheduleUnit(_unit('b', next: '2026-11-13T00:00:00.000Z')), // 3 hari -> due
      ScheduleUnit(_unit('c', next: '2026-11-14T00:00:00.000Z')), // 4 hari -> tidak
      ScheduleUnit(_unit('d', next: '2026-10-01T00:00:00.000Z', job: true)), // job berjalan
      ScheduleUnit(_unit('e', next: '2026-10-01T00:00:00.000Z', enabled: false)),
      ScheduleUnit(_unit('f', next: '2026-10-01T00:00:00.000Z', unitStatus: 'dalam_maintenance')),
      ScheduleUnit(_unit('g', status: 'siklus_kosong')), // tanpa tanggal
      ScheduleUnit(_unit('h', next: '2026-09-01T00:00:00.000Z', status: 'terlambat')), // terlambat ikut
    ];
    expect(dueUnitIds(units, now: _now), {'a', 'b', 'h'});
  });

  test('intervalError: 7..730 hari bulat', () {
    expect(intervalError('abc'), isNotNull);
    expect(intervalError('6'), contains('minimal 7'));
    expect(intervalError('731'), contains('maksimal 730'));
    expect(intervalError('180'), isNull);
  });

  test('MemberScheduleList membaca ringkasan', () {
    final l = MemberScheduleList({
      'counts': {'terlambat': 2, 'segera': 1},
      'total': 1,
      'items': [
        {
          'memberId': 'm1',
          'name': 'Budi',
          'phone': '08',
          'waOptOut': true,
          'unitCount': 3,
          'counts': {'terlambat': 1, 'aman': 2},
          'nextService': {'date': '2026-11-12T00:00:00.000Z', 'status': 'segera'},
          'jobBerjalanCount': 1,
          'lastWa': {'status': 'gagal', 'error': 'nomor salah', 'at': '2026-11-01T00:00:00.000Z', 'kind': 'x'},
        },
      ],
    });
    expect(l.counts['terlambat'], 2);
    expect(l.items.single.counts['aman'], 2);
    expect(l.items.single.lastWa!.label, 'Gagal');
    expect(l.items.single.nextStatus, 'segera');
  });

  testWidgets('daftar pelanggan: chip berisi hitungan; filter memanggil provider dengan status', (t) async {
    final queries = <MemberScheduleQuery>[];
    await t.pumpWidget(ProviderScope(
      overrides: [
        memberScheduleProvider.overrideWith((ref, k) {
          queries.add(k);
          return Future.value(MemberScheduleList({
            'counts': {'terlambat': 4, 'segera': 1},
            'total': 1,
            'items': [
              {'memberId': 'm1', 'name': 'Budi', 'unitCount': 2, 'counts': {'terlambat': 2}, 'jobBerjalanCount': 0},
            ],
          }));
        }),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const ReminderScheduleScreen()),
    ));
    await t.pumpAndSettle();
    expect(find.text('Budi'), findsOneWidget);
    expect(find.text('Terlambat 4'), findsOneWidget);
    await t.tap(find.byKey(const Key('schedule-chip-terlambat')));
    await t.pumpAndSettle();
    expect(queries.last.status, 'terlambat');
  });

  testWidgets('AC pelanggan (admin): unit jatuh tempo tercentang; Kirim sekarang setelah konfirmasi', (t) async {
    final sent = <String>[];
    await t.pumpWidget(ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => Stream.value(
            const AppUser(uid: 'a', email: 'e', displayName: 'Admin', role: UserRole.admin))),
        memberUnitsScheduleProvider.overrideWith((ref, id) => Future.value([
              ScheduleUnit(_unit('a', next: DateTime.now().add(const Duration(days: 1)).toUtc().toIso8601String())),
              ScheduleUnit(_unit('z', status: 'aman', next: DateTime.now().add(const Duration(days: 90)).toUtc().toIso8601String())),
            ])),
        sendReminderNowProvider.overrideWithValue((id) async {
          sent.add(id);
          return 'Pengingat terkirim.';
        }),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const MemberScheduleScreen(memberId: 'm1')),
    ));
    await t.pumpAndSettle();

    expect(t.widget<Checkbox>(find.byKey(const Key('schedule-pick-a'))).value, isTrue);
    expect(t.widget<Checkbox>(find.byKey(const Key('schedule-pick-z'))).value, isFalse);
    expect(find.text('Buat Job Servis (1 unit)'), findsOneWidget);

    await t.tap(find.byKey(const Key('schedule-send-a')));
    await t.pumpAndSettle();
    expect(sent, isEmpty);
    await t.tap(find.byKey(const Key('send-now-confirm')));
    await t.pumpAndSettle();
    expect(sent, ['a']);
  });
}
