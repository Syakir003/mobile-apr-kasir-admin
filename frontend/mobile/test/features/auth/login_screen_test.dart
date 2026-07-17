import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/repositories/auth_repository.dart';
import 'package:epos_ac/features/auth/login_screen.dart';

class FakeAuthRepository implements AuthRepository {
  String? lastEmail;
  String? lastPassword;
  bool failNext = false;

  @override
  Stream<AppUser?> watchCurrentUser() => const Stream.empty();

  @override
  Future<void> signIn({required String email, required String password}) async {
    if (failNext) throw Exception('auth gagal');
    lastEmail = email;
    lastPassword = password;
  }

  @override
  Future<void> signOut() async {}
}

Widget host(FakeAuthRepository fake) => ProviderScope(
      overrides: [authRepositoryProvider.overrideWithValue(fake)],
      child: const MaterialApp(home: LoginScreen()),
    );

void main() {
  testWidgets('submit memanggil signIn dengan email & password', (tester) async {
    final fake = FakeAuthRepository();
    await tester.pumpWidget(host(fake));
    await tester.enterText(find.byKey(const Key('email')), 'kasir@toko.id');
    await tester.enterText(find.byKey(const Key('password')), 'rahasia123');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pump();
    expect(fake.lastEmail, 'kasir@toko.id');
    expect(fake.lastPassword, 'rahasia123');
  });

  testWidgets('email kosong menampilkan error validasi', (tester) async {
    final fake = FakeAuthRepository();
    await tester.pumpWidget(host(fake));
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pump();
    expect(find.text('Email wajib diisi'), findsOneWidget);
    expect(fake.lastEmail, isNull);
  });

  testWidgets('kegagalan auth menampilkan snackbar', (tester) async {
    final fake = FakeAuthRepository()..failNext = true;
    await tester.pumpWidget(host(fake));
    await tester.enterText(find.byKey(const Key('email')), 'x@y.z');
    await tester.enterText(find.byKey(const Key('password')), '12345678');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Login gagal'), findsOneWidget);
  });
}
