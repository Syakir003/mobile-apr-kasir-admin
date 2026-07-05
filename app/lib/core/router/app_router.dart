import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/app_user.dart';
import '../../data/models/installation_package.dart';
import '../../data/models/product.dart';
import '../../data/models/service_item.dart';
import '../../data/models/sparepart.dart';
import '../../data/repositories/auth_repository.dart';
import '../../features/auth/login_screen.dart';
import '../../features/dashboard/dashboard_screen.dart';
import '../../features/master/package/package_form_screen.dart';
import '../../features/master/package/package_list_screen.dart';
import '../../features/master/product/product_form_screen.dart';
import '../../features/master/product/product_list_screen.dart';
import '../../features/master/service/service_form_screen.dart';
import '../../features/master/service/service_list_screen.dart';
import '../../features/master/sparepart/sparepart_form_screen.dart';
import '../../features/master/sparepart/sparepart_list_screen.dart';
import '../widgets/adaptive_scaffold.dart';
import 'redirect.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => FirebaseAuthRepository(fb.FirebaseAuth.instance),
);

final currentUserProvider = StreamProvider<AppUser?>(
  (ref) => ref.watch(authRepositoryProvider).watchCurrentUser(),
);

/// Router dibuat sekali; perubahan auth state disebarkan lewat [refreshListenable]
/// (ValueNotifier) sehingga GoRouter tidak dibangun ulang dan navigation stack
/// tetap utuh saat token refresh atau login/logout.
final appRouterProvider = Provider<GoRouter>((ref) {
  final notifier = ValueNotifier<AsyncValue<AppUser?>>(const AsyncValue.loading());
  ref.onDispose(notifier.dispose);
  ref.listen<AsyncValue<AppUser?>>(
    currentUserProvider,
    (_, next) => notifier.value = next,
    fireImmediately: true,
  );

  return GoRouter(
    initialLocation: '/',
    refreshListenable: notifier,
    redirect: (context, state) =>
        computeRedirectFromAsync(notifier.value, state.matchedLocation),
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      ShellRoute(
        builder: (_, __, child) => AdaptiveScaffold(child: child),
        routes: [
          GoRoute(path: '/', builder: (_, __) => const DashboardScreen()),
          GoRoute(
            path: '/products',
            builder: (_, __) => const ProductListScreen(),
            routes: [
              GoRoute(
                path: 'new',
                builder: (_, __) => const ProductFormScreen(),
              ),
              GoRoute(
                path: ':id/edit',
                builder: (_, state) =>
                    ProductFormScreen(initial: state.extra as Product?),
              ),
            ],
          ),
          GoRoute(
            path: '/spareparts',
            builder: (_, __) => const SparepartListScreen(),
            routes: [
              GoRoute(
                path: 'new',
                builder: (_, __) => const SparepartFormScreen(),
              ),
              GoRoute(
                path: ':id/edit',
                builder: (_, state) =>
                    SparepartFormScreen(initial: state.extra as Sparepart?),
              ),
            ],
          ),
          GoRoute(
            path: '/services',
            builder: (_, __) => const ServiceListScreen(),
            routes: [
              GoRoute(
                path: 'new',
                builder: (_, __) => const ServiceFormScreen(),
              ),
              GoRoute(
                path: ':id/edit',
                builder: (_, state) =>
                    ServiceFormScreen(initial: state.extra as ServiceItem?),
              ),
            ],
          ),
          GoRoute(
            path: '/packages',
            builder: (_, __) => const PackageListScreen(),
            routes: [
              GoRoute(
                path: 'new',
                builder: (_, __) => const PackageFormScreen(),
              ),
              GoRoute(
                path: ':id/edit',
                builder: (_, state) => PackageFormScreen(
                  initial: state.extra as InstallationPackage?,
                ),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

String? computeRedirectFromAsync(
  AsyncValue<AppUser?> userAsync,
  String location,
) {
  return switch (userAsync) {
    AsyncData(:final value) =>
      _r(value, value?.role, false, location),
    AsyncLoading() => _r(null, null, true, location),
    _ => _r(null, null, false, location),
  };
}

String? _r(AppUser? user, UserRole? role, bool loading, String location) =>
    computeRedirect(user: user, role: role, loading: loading, location: location);
