import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/router/app_router.dart';
import 'core/supabase/supabase_bootstrap.dart';
import 'core/theme/app_theme.dart';
import 'data/models/app_user.dart';
import 'features/notifications/fcm_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await bootstrapSupabase();
  runApp(const ProviderScope(child: EposApp()));
}

class EposApp extends ConsumerWidget {
  const EposApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    // FCM: daftarkan token saat user login, lepas saat logout. Guarded — no-op
    // bila Firebase belum dikonfigurasi.
    ref.listen<AsyncValue<AppUser?>>(currentUserProvider, (prev, next) {
      final was = prev?.value;
      final now = next.value;
      final fcm = ref.read(fcmServiceProvider);
      if (now != null && was?.uid != now.uid) {
        fcm.start();
      } else if (now == null && was != null) {
        fcm.stop();
      }
    });

    return MaterialApp.router(
      title: 'E-POS AC',
      theme: AppTheme.light(),
      routerConfig: router,
    );
  }
}
