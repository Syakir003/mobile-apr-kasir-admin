import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/app_user.dart';
import '../../data/repositories/auth_repository.dart';
import '../../features/auth/login_screen.dart';
import '../../features/dashboard/dashboard_screen.dart';
import '../widgets/adaptive_scaffold.dart';
import 'redirect.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => FirebaseAuthRepository(fb.FirebaseAuth.instance),
);

final currentUserProvider = StreamProvider<AppUser?>(
  (ref) => ref.watch(authRepositoryProvider).watchCurrentUser(),
);

final appRouterProvider = Provider<GoRouter>((ref) {
  final userAsync = ref.watch(currentUserProvider);
  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) =>
        computeRedirectFromAsync(userAsync, state.matchedLocation),
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      ShellRoute(
        builder: (_, __, child) => AdaptiveScaffold(child: child),
        routes: [
          GoRoute(path: '/', builder: (_, __) => const DashboardScreen()),
        ],
      ),
    ],
  );
});

String? computeRedirectFromAsync(AsyncValue<AppUser?> userAsync, String location) {
  return switch (userAsync) {
    AsyncData(:final value) => _r(value, false, location),
    AsyncLoading() => _r(null, true, location),
    _ => _r(null, false, location),
  };
}

String? _r(AppUser? user, bool loading, String location) =>
    computeRedirect(user: user, loading: loading, location: location);
