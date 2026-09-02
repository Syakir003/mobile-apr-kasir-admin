import 'package:epos_ac/data/models/wa_message.dart';
import 'package:epos_ac/features/reminders/reminder_providers.dart';
import 'package:epos_ac/features/reminders/wa_history_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

WaMessage _msg({
  String id = 'w1',
  WaKind kind = WaKind.reminderH3,
  WaStatus status = WaStatus.terkirim,
  String body = 'Halo Budi, AC berikut dijadwalkan servis.',
  String? error,
}) =>
    WaMessage(
      id: id,
      memberId: 'm1',
      memberName: 'Budi Santoso',
      phone: '62812345678',
      kind: kind,
      body: body,
      status: status,
      unitCount: 1,
      dueDate: DateTime(2026, 8, 20),
      createdAt: DateTime(2026, 8, 15),
      sentAt: status == WaStatus.terkirim ? DateTime(2026, 8, 17) : null,
      error: error,
    );

Widget _host(List<WaMessage> riwayat) {
  return ProviderScope(
    overrides: [
      waHistoryProvider.overrideWith((ref) async => riwayat),
      waMemberNamesProvider.overrideWithValue(const {'m1': 'Budi Santoso'}),
    ],
    child: const MaterialApp(home: WaHistoryScreen()),
  );
}

void main() {
  testWidgets('riwayat kosong menampilkan empty state', (tester) async {
    await tester.pumpWidget(_host(const []));
    await tester.pumpAndSettle();

    expect(find.text('Belum ada riwayat'), findsOneWidget);
  });

  testWidgets('kartu menampilkan status, jenis, dan isi pesan', (tester) async {
    await tester.pumpWidget(_host([_msg()]));
    await tester.pumpAndSettle();

    expect(find.text('Budi Santoso'), findsOneWidget);
    expect(find.text('Terkirim'), findsOneWidget);
    expect(find.textContaining('Pengingat H-3'), findsOneWidget);
    expect(
      find.text('Halo Budi, AC berikut dijadwalkan servis.'),
      findsOneWidget,
    );
  });

  testWidgets('pesan dibatalkan menampilkan alasannya', (tester) async {
    await tester.pumpWidget(_host([
      _msg(status: WaStatus.dibatalkan, error: 'Pelanggan opt-out'),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('Dibatalkan'), findsOneWidget);
    expect(find.textContaining('Pelanggan opt-out'), findsOneWidget);
  });

  testWidgets('layar read-only: tak ada tombol kirim / batal', (tester) async {
    await tester.pumpWidget(_host([_msg()]));
    await tester.pumpAndSettle();

    expect(find.text('Kirim via WhatsApp'), findsNothing);
    expect(find.text('Batalkan'), findsNothing);
  });
}
