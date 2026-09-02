import 'package:epos_ac/data/models/wa_message.dart';
import 'package:epos_ac/features/reminders/reminder_providers.dart';
import 'package:epos_ac/features/reminders/reminder_template_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

const _kSelesai = 'Halo {nama}, servis selesai untuk {unit}. Sampai {tanggal}.';
const _kH3 = 'Halo {nama}, servis {unit} dijadwalkan {tanggal}.';
const _kH7 = 'Halo {nama}, servis {unit} lewat sejak {tanggal}.';

List<WaTemplate> _seed() => const [
      WaTemplate(
        kind: WaKind.selesaiServis,
        body: _kSelesai,
        defaultBody: 'BAWAAN selesai {nama} {unit} {tanggal}',
      ),
      WaTemplate(
        kind: WaKind.reminderH3,
        body: _kH3,
        defaultBody: 'BAWAAN h3 {nama} {unit} {tanggal}',
      ),
      WaTemplate(
        kind: WaKind.reminderH7,
        body: _kH7,
        defaultBody: 'BAWAAN h7 {nama} {unit} {tanggal}',
      ),
    ];

Widget _host({
  required List<WaTemplate> templates,
  Map<WaKind, String>? saved,
  Future<void> Function(Map<WaKind, String>)? onSave,
}) {
  final router = GoRouter(
    initialLocation: '/pengingat/pengaturan/pesan',
    routes: [
      GoRoute(
        path: '/pengingat/pengaturan',
        builder: (_, __) => const Scaffold(body: Text('pengaturan')),
        routes: [
          GoRoute(
            path: 'pesan',
            builder: (_, __) => const ReminderTemplateScreen(),
          ),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      waTemplatesProvider.overrideWith((ref) async => templates),
      saveWaTemplatesCallerProvider.overrideWithValue(
        onSave ?? (m) async => saved?.addAll(m),
      ),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

void _tallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(900, 3200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('menampilkan teks template dari server', (tester) async {
    _tallViewport(tester);
    await tester.pumpWidget(_host(templates: _seed()));
    await tester.pumpAndSettle();

    expect(find.text(_kSelesai), findsOneWidget);
    expect(find.text(_kH3), findsOneWidget);
    expect(find.text(_kH7), findsOneWidget);
  });

  testWidgets('edit lalu simpan mengirim ketiga teks ke RPC', (tester) async {
    _tallViewport(tester);
    final saved = <WaKind, String>{};
    await tester.pumpWidget(_host(templates: _seed(), saved: saved));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('teks-selesai_servis')),
      'Halo {nama}, beres!',
    );
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(saved[WaKind.selesaiServis], 'Halo {nama}, beres!');
    expect(saved[WaKind.reminderH3], _kH3);
    expect(saved[WaKind.reminderH7], _kH7);
    expect(find.text('pengaturan'), findsOneWidget);
  });

  testWidgets('reset ke bawaan mengembalikan teks pabrik', (tester) async {
    _tallViewport(tester);
    await tester.pumpWidget(_host(templates: _seed()));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('teks-reminder_h3')),
      'diubah sembarang',
    );
    await tester.pumpAndSettle();
    // Muncul di field dan di pratinjau (tanpa placeholder, keduanya sama persis).
    expect(find.text('diubah sembarang'), findsWidgets);

    await tester.tap(find.byKey(const Key('reset-reminder_h3')));
    await tester.pumpAndSettle();

    expect(find.text('BAWAAN h3 {nama} {unit} {tanggal}'), findsOneWidget);
  });

  testWidgets('teks kosong memblokir simpan', (tester) async {
    _tallViewport(tester);
    final saved = <WaKind, String>{};
    await tester.pumpWidget(_host(templates: _seed(), saved: saved));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('teks-selesai_servis')), '');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(find.text('Teks pesan wajib diisi'), findsOneWidget);
    expect(saved, isEmpty);
  });

  testWidgets('placeholder tak dikenal memblokir simpan', (tester) async {
    _tallViewport(tester);
    final saved = <WaKind, String>{};
    await tester.pumpWidget(_host(templates: _seed(), saved: saved));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('teks-reminder_h7')),
      'Halo {name}, cek {unit}',
    );
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(find.textContaining('Kata kunci tak dikenal'), findsOneWidget);
    expect(saved, isEmpty);
  });
}
