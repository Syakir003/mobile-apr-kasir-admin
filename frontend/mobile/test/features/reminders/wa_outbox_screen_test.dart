import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/wa_message.dart';
import 'package:epos_ac/features/reminders/reminder_providers.dart';
import 'package:epos_ac/features/reminders/wa_outbox_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const _kasir =
    AppUser(uid: 'k', email: 'k@e.id', displayName: 'Kasir', role: UserRole.kasir);
const _admin =
    AppUser(uid: 'a', email: 'a@e.id', displayName: 'Admin', role: UserRole.admin);

WaMessage _pesan({
  String id = 'w1',
  WaKind kind = WaKind.reminderH3,
  String body = 'Halo Budi, AC berikut dijadwalkan servis.',
}) =>
    WaMessage(
      id: id,
      memberId: 'm1',
      memberName: '',
      phone: '62812345678',
      kind: kind,
      body: body,
      status: WaStatus.gagal,
      error: 'Nomor tidak terdaftar di WhatsApp',
      unitCount: 2,
      dueDate: DateTime(2026, 8, 20),
      createdAt: DateTime(2026, 8, 15),
    );

Widget _host({
  required List<WaMessage> gagal,
  AppUser user = _kasir,
  Map<String, String> nama = const {'m1': 'Budi Santoso'},
  List<String>? dikirimUlang,
}) {
  return ProviderScope(
    overrides: [
      currentUserProvider.overrideWith((ref) => Stream.value(user)),
      waFailedProvider.overrideWith((ref) async => gagal),
      waHistoryProvider.overrideWith((ref) async => const []),
      waMemberNamesProvider.overrideWithValue(nama),
      retryWaCallerProvider.overrideWithValue((id) async => dikirimUlang?.add(id)),
    ],
    child: const MaterialApp(home: WaOutboxScreen()),
  );
}

void main() {
  testWidgets('tanpa pesan gagal menampilkan empty state', (tester) async {
    await tester.pumpWidget(_host(gagal: const []));
    await tester.pumpAndSettle();

    expect(find.text('Tidak ada pesan gagal'), findsOneWidget);
  });

  testWidgets('kartu menampilkan nama, jenis pesan, dan alasan gagal', (tester) async {
    await tester.pumpWidget(_host(gagal: [_pesan()]));
    await tester.pumpAndSettle();

    expect(find.text('Budi Santoso'), findsOneWidget);
    expect(find.text('Pengingat H-3'), findsOneWidget);
    expect(find.textContaining('2 unit AC'), findsOneWidget);
    expect(find.textContaining('20 Agustus 2026'), findsOneWidget);
    expect(find.textContaining('Nomor tidak terdaftar'), findsOneWidget);
  });

  testWidgets('admin bisa kirim ulang', (tester) async {
    final dikirim = <String>[];
    await tester.pumpWidget(_host(gagal: [_pesan()], user: _admin, dikirimUlang: dikirim));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('kirim-ulang-w1')));
    await tester.pumpAndSettle();

    expect(dikirim, ['w1']);
    expect(find.text('Pesan dikirim ulang.'), findsOneWidget);
  });

  testWidgets('kasir tidak bisa kirim ulang (endpoint admin-only)', (tester) async {
    await tester.pumpWidget(_host(gagal: [_pesan()]));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('kirim-ulang-w1')), findsNothing);
  });

  testWidgets('kasir tidak melihat pintasan pengaturan (admin-only)', (tester) async {
    await tester.pumpWidget(_host(gagal: [_pesan()]));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('buka-pengaturan')), findsNothing);
  });

  testWidgets('admin melihat pintasan pengaturan', (tester) async {
    await tester.pumpWidget(_host(gagal: [_pesan()], user: _admin));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('buka-pengaturan')), findsOneWidget);
  });

  testWidgets('semua peran melihat pintasan riwayat', (tester) async {
    await tester.pumpWidget(_host(gagal: [_pesan()]));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('buka-riwayat')), findsOneWidget);
  });
}
