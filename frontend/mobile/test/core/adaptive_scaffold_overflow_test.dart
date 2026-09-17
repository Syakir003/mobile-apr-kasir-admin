// Reproduksi laporan: tab "Lainnya" (titik tiga) di bottom nav portrait
// tidak bisa dibuka. Menguji AdaptiveScaffold lengkap (bukan cuma fungsi
// murni destinationsForRole/selectedIndexFor) di lebar sempit (<800), tempat
// _MobileNav dipakai dan overflow "Lainnya" muncul untuk admin (19 destinasi).
import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

void main() {
  testWidgets('tab Lainnya membuka bottom sheet berisi sisa menu (portrait)',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        ShellRoute(
          builder: (_, __, child) => AdaptiveScaffold(child: child),
          routes: [
            for (final r in const [
              '/',
              '/pos',
              '/transactions',
              '/products',
              '/spareparts',
              '/services',
              '/packages',
              '/members',
              '/orders',
              '/jobs',
              '/pengingat',
              '/voucher',
              '/undian',
              '/stok',
              '/laporan',
              '/users',
              '/audit',
              '/scan',
              '/profile',
            ])
              GoRoute(path: r, builder: (_, __) => const SizedBox.shrink()),
          ],
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserProvider.overrideWith(
            (ref) => Stream.value(
              const AppUser(
                uid: 'u1',
                email: 'admin@ayub.id',
                displayName: 'Admin',
                role: UserRole.admin,
              ),
            ),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Lainnya'), findsOneWidget);
    expect(find.text('Stok'), findsNothing);

    await tester.tap(find.text('Lainnya'));
    await tester.pumpAndSettle();

    expect(find.text('Pengingat'), findsOneWidget);

    // Item terakhir (Profil, ke-15 di overflow) harus terjangkau lewat scroll
    // — bukan cuma yang kebetulan muat di layar pertama.
    await tester.dragUntilVisible(
      find.text('Profil'),
      find.byType(ListView),
      const Offset(0, -200),
    );
    expect(find.text('Profil'), findsOneWidget);
  });

  testWidgets(
      'tombol back Android kembali ke menu sebelumnya sesuai urutan '
      'kunjungan, bukan langsung keluar app', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        ShellRoute(
          builder: (_, __, child) => AdaptiveScaffold(child: child),
          routes: [
            for (final r in const ['/', '/pos', '/laporan', '/voucher'])
              GoRoute(path: r, builder: (_, __) => Text('layar $r')),
            for (final r in const [
              '/transactions',
              '/products',
              '/spareparts',
              '/services',
              '/packages',
              '/members',
              '/orders',
              '/jobs',
              '/pengingat',
              '/undian',
              '/stok',
              '/users',
              '/audit',
              '/scan',
              '/profile',
            ])
              GoRoute(path: r, builder: (_, __) => const SizedBox.shrink()),
          ],
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserProvider.overrideWith(
            (ref) => Stream.value(
              const AppUser(
                uid: 'u1',
                email: 'admin@ayub.id',
                displayName: 'Admin',
                role: UserRole.admin,
              ),
            ),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('layar /'), findsOneWidget);

    // Dashboard -> Laporan (lewat sheet "Lainnya") -> Voucher.
    await tester.tap(find.text('Lainnya'));
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
      find.text('Laporan'),
      find.byType(ListView),
      const Offset(0, -200),
    );
    await tester.tap(find.text('Laporan'));
    await tester.pumpAndSettle();
    expect(find.text('layar /laporan'), findsOneWidget);

    await tester.tap(find.text('Lainnya'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Voucher'));
    await tester.pumpAndSettle();
    expect(find.text('layar /voucher'), findsOneWidget);

    // Simulasikan tombol back Android (bukan tombol back di AppBar).
    Future<void> pressSystemBack() => tester.binding.handlePopRoute();

    await pressSystemBack();
    await tester.pumpAndSettle();
    expect(find.text('layar /laporan'), findsOneWidget);

    await pressSystemBack();
    await tester.pumpAndSettle();
    expect(find.text('layar /'), findsOneWidget);
  });
}
