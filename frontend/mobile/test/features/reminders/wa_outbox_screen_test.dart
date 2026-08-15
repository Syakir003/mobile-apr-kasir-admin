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
      status: WaStatus.pending,
      unitCount: 2,
      dueDate: DateTime(2026, 8, 20),
      createdAt: DateTime(2026, 8, 15),
    );

Widget _host({
  required List<WaMessage> antrean,
  AppUser user = _kasir,
  Map<String, String> nama = const {'m1': 'Budi Santoso'},
  Future<bool> Function(Uri)? launcher,
  List<String>? ditandaiTerkirim,
  List<String>? dibatalkan,
}) {
  return ProviderScope(
    overrides: [
      currentUserProvider.overrideWith((ref) => Stream.value(user)),
      waOutboxStreamProvider.overrideWith((ref) => Stream.value(antrean)),
      waMemberNamesProvider.overrideWithValue(nama),
      waLauncherProvider.overrideWithValue(launcher ?? (_) async => true),
      markWaSentCallerProvider.overrideWithValue(
        (id) async => ditandaiTerkirim?.add(id),
      ),
      cancelWaMessageCallerProvider.overrideWithValue(
        (id, {reason}) async => dibatalkan?.add(id),
      ),
    ],
    child: const MaterialApp(home: WaOutboxScreen()),
  );
}

void main() {
  testWidgets('antrean kosong menampilkan empty state', (tester) async {
    await tester.pumpWidget(_host(antrean: const []));
    await tester.pumpAndSettle();

    expect(find.text('Tidak ada pesan menunggu'), findsOneWidget);
  });

  testWidgets('kartu menampilkan nama pelanggan & badge jenis pesan',
      (tester) async {
    await tester.pumpWidget(_host(antrean: [_pesan()]));
    await tester.pumpAndSettle();

    // Nama datang dari tabel members (Realtime `wa_outbox` tidak membawanya).
    expect(find.text('Budi Santoso'), findsOneWidget);
    expect(find.text('Pengingat H-3'), findsOneWidget);
    expect(find.textContaining('2 unit AC'), findsOneWidget);
    expect(find.textContaining('20 Agustus 2026'), findsOneWidget);
  });

  testWidgets('kirim: WhatsApp terbuka lalu pesan ditandai terkirim',
      (tester) async {
    final dibuka = <Uri>[];
    final terkirim = <String>[];
    await tester.pumpWidget(_host(
      antrean: [_pesan()],
      launcher: (uri) async {
        dibuka.add(uri);
        return true;
      },
      ditandaiTerkirim: terkirim,
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('kirim-w1')));
    await tester.pumpAndSettle();

    expect(dibuka.single.host, 'wa.me');
    expect(terkirim, ['w1']);
  });

  testWidgets('WhatsApp tidak terpasang: status TIDAK diubah', (tester) async {
    final terkirim = <String>[];
    await tester.pumpWidget(_host(
      antrean: [_pesan()],
      launcher: (_) async => false,
      ditandaiTerkirim: terkirim,
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('kirim-w1')));
    await tester.pumpAndSettle();

    expect(terkirim, isEmpty);
    expect(find.textContaining('WhatsApp tidak terpasang'), findsOneWidget);
  });

  testWidgets('batalkan minta konfirmasi dulu', (tester) async {
    final dibatalkan = <String>[];
    await tester.pumpWidget(
      _host(antrean: [_pesan()], dibatalkan: dibatalkan),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('batal-w1')));
    await tester.pumpAndSettle();
    expect(find.text('Batalkan pengingat?'), findsOneWidget);

    // Menutup dialog dengan "Tidak" tidak boleh memanggil RPC.
    await tester.tap(find.text('Tidak'));
    await tester.pumpAndSettle();
    expect(dibatalkan, isEmpty);

    await tester.tap(find.byKey(const Key('batal-w1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('konfirmasi-batal')));
    await tester.pumpAndSettle();
    expect(dibatalkan, ['w1']);
  });

  testWidgets('kasir tidak melihat pintasan pengaturan (admin-only)',
      (tester) async {
    await tester.pumpWidget(_host(antrean: [_pesan()]));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('buka-pengaturan')), findsNothing);
  });

  testWidgets('admin melihat pintasan pengaturan', (tester) async {
    await tester.pumpWidget(_host(antrean: [_pesan()], user: _admin));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('buka-pengaturan')), findsOneWidget);
  });
}
