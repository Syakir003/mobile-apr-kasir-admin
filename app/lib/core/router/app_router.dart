import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../data/models/ac_unit.dart';
import '../../data/models/app_user.dart';
import '../../data/models/installation_package.dart';
import '../../data/models/member.dart';
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
import '../../features/members/member_detail_screen.dart';
import '../../features/members/member_form_screen.dart';
import '../../features/members/member_list_screen.dart';
import '../../features/members/unit_form_screen.dart';
import '../../features/pos/checkout_screen.dart';
import '../../features/pos/pos_screen.dart';
import '../../features/scan/scan_screen.dart';
import '../../features/transactions/invoice_detail_screen.dart';
import '../../features/transactions/invoice_list_screen.dart';
import '../widgets/adaptive_scaffold.dart';
import 'redirect.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => SupabaseAuthRepository(Supabase.instance.client.auth),
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
            path: '/pos',
            builder: (_, __) => const PosScreen(),
            routes: [
              GoRoute(
                path: 'checkout',
                builder: (_, __) => const CheckoutScreen(),
              ),
            ],
          ),
          GoRoute(
            path: '/transactions',
            builder: (_, __) => const InvoiceListScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (_, state) => InvoiceDetailScreen(
                  invoiceId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
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
          GoRoute(
            path: '/members',
            builder: (_, __) => const MemberListScreen(),
            routes: [
              GoRoute(
                path: 'new',
                builder: (_, __) => const MemberFormScreen(),
              ),
              GoRoute(
                path: ':id',
                builder: (_, state) => MemberDetailScreen(
                  memberId: state.pathParameters['id']!,
                  initial: state.extra as Member?,
                ),
                routes: [
                  GoRoute(
                    path: 'edit',
                    builder: (_, state) =>
                        MemberFormScreen(initial: state.extra as Member?),
                  ),
                  GoRoute(
                    path: 'units/new',
                    builder: (_, state) => UnitFormScreen(
                      memberId: state.pathParameters['id']!,
                    ),
                  ),
                  GoRoute(
                    path: 'units/:unitId/edit',
                    builder: (_, state) => UnitFormScreen(
                      memberId: state.pathParameters['id']!,
                      initial: state.extra as AcUnit?,
                    ),
                  ),
                ],
              ),
            ],
          ),
          GoRoute(path: '/scan', builder: (_, __) => const ScanScreen()),
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
