// Harness sementara: merender shell aplikasi (sidebar lebar) jadi PNG untuk
// dibandingkan dengan frame `SideNavBar` (10:267) di Figma.
// Jalankan: flutter test --update-goldens test/shell_preview_golden.dart
import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

Future<void> _loadFont(String family, List<String> assets) async {
  final loader = FontLoader(family);
  for (final a in assets) {
    loader.addFont(rootBundle.load(a));
  }
  await loader.load();
}

void main() {
  setUpAll(() async {
    await _loadFont('PlusJakartaSans', const [
      'assets/fonts/PlusJakartaSans-Medium.ttf',
      'assets/fonts/PlusJakartaSans-SemiBold.ttf',
      'assets/fonts/PlusJakartaSans-Bold.ttf',
    ]);
    await _loadFont('Inter', const [
      'assets/fonts/Inter-Regular.ttf',
      'assets/fonts/Inter-Medium.ttf',
      'assets/fonts/Inter-SemiBold.ttf',
    ]);
  });

  testWidgets('shell admin (lebar)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1280, 900));

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
              '/stok',
              '/laporan',
              '/users',
              '/audit',
              '/scan',
              '/profile',
            ])
              GoRoute(
                path: r,
                builder: (_, __) => const ColoredBox(
                  color: AppColors.cloud,
                  child: SizedBox.expand(),
                ),
              ),
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
                displayName: 'Ayub Podo Rukun',
                role: UserRole.admin,
              ),
            ),
          ),
        ],
        child: MaterialApp.router(
          theme: AppTheme.light(),
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(AdaptiveScaffold),
      matchesGoldenFile('preview_shell.png'),
    );
  });
}
