import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/managed_user.dart';
import 'package:epos_ac/features/users/user_form_screen.dart';
import 'package:epos_ac/features/users/user_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

const _admin =
    AppUser(uid: 'a1', email: 'a@x.id', displayName: 'Adm', role: UserRole.admin);

const _budi = ManagedUser(
  id: 'u2',
  email: 'budi@x.id',
  displayName: 'Budi',
  role: UserRole.kasir,
  active: true,
);

const _diriSendiri = ManagedUser(
  id: 'a1',
  email: 'a@x.id',
  displayName: 'Adm',
  role: UserRole.admin,
  active: true,
);

/// Form memanggil `router.pop()` setelah sukses, jadi ia butuh GoRouter dengan
/// rute induk '/users' untuk dituju.
Widget _wrap({
  required String location,
  ManagedUser? initial,
  List<Map<String, dynamic>>? created,
  List<Map<String, dynamic>>? updated,
  List<ManagedUser> users = const [_budi],
}) {
  final router = GoRouter(
    initialLocation: location,
    routes: [
      GoRoute(
        path: '/users',
        builder: (_, __) => const Scaffold(body: Text('daftar akun')),
        routes: [
          GoRoute(
            path: 'new',
            builder: (_, __) => const UserFormScreen(),
          ),
          GoRoute(
            path: ':id',
            builder: (_, state) => UserFormScreen(
              userId: state.pathParameters['id'],
              initial: initial,
            ),
          ),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      currentUserProvider.overrideWith((ref) => Stream.value(_admin)),
      managedUsersProvider.overrideWith((ref) => Stream.value(users)),
      createUserAccountCallerProvider.overrideWithValue((body) async {
        created?.add(body);
      }),
      updateUserAccountCallerProvider.overrideWithValue((payload) async {
        updated?.add(payload);
      }),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

/// Form akun lebih tinggi dari viewport test bawaan (800x600); tanpa ini
/// tombol simpan & switch aktif tidak ikut ter-layout.
void _useTallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('buat akun: validasi kosong menahan pemanggilan', (tester) async {
    _useTallViewport(tester);
    final created = <Map<String, dynamic>>[];
    await tester.pumpWidget(
      _wrap(location: '/users/new', created: created),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('user-submit')));
    await tester.pumpAndSettle();

    expect(find.text('Email wajib diisi'), findsOneWidget);
    expect(find.text('Password minimal 6 karakter'), findsOneWidget);
    expect(find.text('Nama wajib diisi'), findsOneWidget);
    expect(created, isEmpty);
  });

  testWidgets('buat akun: password pendek ditolak sebelum kirim',
      (tester) async {
    _useTallViewport(tester);
    final created = <Map<String, dynamic>>[];
    await tester.pumpWidget(
      _wrap(location: '/users/new', created: created),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('user-email')), 'tek@x.id');
    await tester.enterText(find.byKey(const Key('user-password')), '123');
    await tester.enterText(find.byKey(const Key('user-name')), 'Teknisi A');
    await tester.tap(find.byKey(const Key('user-submit')));
    await tester.pumpAndSettle();

    expect(find.text('Password minimal 6 karakter'), findsOneWidget);
    expect(created, isEmpty);
  });

  testWidgets('buat akun valid mengirim email, password, nama & peran',
      (tester) async {
    _useTallViewport(tester);
    final created = <Map<String, dynamic>>[];
    await tester.pumpWidget(
      _wrap(location: '/users/new', created: created),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('user-email')), ' Tek@X.id ');
    await tester.enterText(find.byKey(const Key('user-password')), 'rahasia1');
    await tester.enterText(find.byKey(const Key('user-name')), ' Teknisi A ');

    await tester.tap(find.byKey(const Key('user-role')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Teknisi — job & scan').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('user-submit')));
    await tester.pumpAndSettle();

    expect(created, hasLength(1));
    expect(created.single, {
      'email': 'Tek@X.id',
      'password': 'rahasia1',
      'displayName': 'Teknisi A',
      'role': 'teknisi',
    });
  });

  testWidgets('ubah akun: field terisi dari data & payload memuat userId',
      (tester) async {
    _useTallViewport(tester);
    final updated = <Map<String, dynamic>>[];
    await tester.pumpWidget(_wrap(
      location: '/users/u2',
      initial: _budi,
      updated: updated,
    ));
    await tester.pumpAndSettle();

    // Email terkunci pada mode ubah.
    final email = tester.widget<TextFormField>(
      find.byKey(const Key('user-email')),
    );
    expect(email.enabled, isFalse);
    expect(find.text('budi@x.id'), findsOneWidget);
    expect(find.text('Budi'), findsOneWidget);
    expect(find.text('Password'), findsNothing);

    await tester.tap(find.byKey(const Key('user-role')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Admin — akses penuh').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('user-submit')));
    await tester.pumpAndSettle();

    expect(updated, hasLength(1));
    expect(updated.single, {
      'userId': 'u2',
      'role': 'admin',
      'active': true,
      'displayName': 'Budi',
    });
  });

  testWidgets('nonaktifkan akun mengirim active: false', (tester) async {
    _useTallViewport(tester);
    final updated = <Map<String, dynamic>>[];
    await tester.pumpWidget(_wrap(
      location: '/users/u2',
      initial: _budi,
      updated: updated,
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('user-active')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('user-submit')));
    await tester.pumpAndSettle();

    expect(updated.single['active'], isFalse);
  });

  testWidgets('akun sendiri: peran & status terkunci di UI', (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(
      location: '/users/a1',
      initial: _diriSendiri,
      users: const [_diriSendiri],
    ));
    await tester.pumpAndSettle();

    final role = tester.widget<DropdownButtonFormField<UserRole>>(
      find.byKey(const Key('user-role')),
    );
    expect(role.onChanged, isNull);

    final active = tester.widget<SwitchListTile>(
      find.byKey(const Key('user-active')),
    );
    expect(active.onChanged, isNull);

    expect(
      find.textContaining('Peran & status akun sendiri tidak bisa diubah'),
      findsOneWidget,
    );
  });

  testWidgets('deep link tanpa extra: data diambil dari daftar realtime',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(
      location: '/users/u2',
      users: const [_budi],
    ));
    await tester.pumpAndSettle();

    expect(find.text('Budi'), findsOneWidget);
    expect(find.text('budi@x.id'), findsOneWidget);
  });
}
