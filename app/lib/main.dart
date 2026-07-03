import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/firebase/firebase_bootstrap.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await bootstrapFirebase(options: DefaultFirebaseOptions.currentPlatform);
  runApp(const ProviderScope(child: EposApp()));
}

class EposApp extends ConsumerWidget {
  const EposApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    return MaterialApp.router(
      title: 'E-POS AC',
      theme: AppTheme.light(),
      routerConfig: router,
    );
  }
}
