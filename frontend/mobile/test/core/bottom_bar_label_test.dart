// Laporan: label bottom bar pecah dua baris & mepet saat ukuran teks sistem diperbesar. Bar sekarang mengunci skala
// teks 1.0x dan memakai label ringkas.
import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

void main() {
  for (final role in [UserRole.admin, UserRole.kasir]) {
    testWidgets('${role.name}: skala teks bottom bar terkunci 1.0x dan labelnya ringkas', (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1.0;
      tester.platformDispatcher.textScaleFactorTestValue = 1.5;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      final dests = destinationsForRole(role);
      final router = GoRouter(
        initialLocation: '/',
        routes: [
          ShellRoute(
            builder: (_, __, child) => AdaptiveScaffold(child: child),
            routes: [
              for (final d in dests) GoRoute(path: d.route, builder: (_, __) => const SizedBox.shrink()),
            ],
          ),
        ],
      );
      await tester.pumpWidget(ProviderScope(
        overrides: [
          currentUserProvider.overrideWith(
              (ref) => Stream.value(AppUser(uid: 'u', email: 'e', displayName: 'U', role: role))),
        ],
        child: MaterialApp.router(routerConfig: router),
      ));
      await tester.pumpAndSettle();

      final bar = find.byType(NavigationBar);
      // Isi halaman tetap mengikuti sistem (1.5x); hanya bar yang dikunci.
      expect(MediaQuery.of(tester.element(find.byType(AdaptiveScaffold))).textScaler.scale(12), 18);
      expect(MediaQuery.of(tester.element(bar)).textScaler.scale(12), 12);

      for (final long in ['Kasir (POS)', 'Riwayat Transaksi', 'Terima Servis Baru', 'Antrian Servis']) {
        expect(find.descendant(of: bar, matching: find.text(long)), findsNothing, reason: long);
      }
    });
  }
}
