import 'package:epos_ac/data/models/member.dart';
import 'package:epos_ac/features/members/member_form_screen.dart';
import 'package:epos_ac/features/members/member_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../../support/fake_crud_repository.dart';

Widget _host(FakeCrudRepository<Member> repo) {
  final router = GoRouter(
    initialLocation: '/members/new',
    routes: [
      GoRoute(
        path: '/members',
        builder: (_, __) => const Scaffold(body: Text('list')),
        routes: [
          GoRoute(path: 'new', builder: (_, __) => const MemberFormScreen()),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [memberRepositoryProvider.overrideWithValue(repo)],
    child: MaterialApp.router(routerConfig: router),
  );
}

void _useTallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('submit kosong menampilkan error validasi', (tester) async {
    _useTallViewport(tester);
    final repo = FakeCrudRepository<Member>();
    addTearDown(repo.dispose);
    await tester.pumpWidget(_host(repo));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.text('Wajib diisi'), findsWidgets);
    expect(repo.created, isEmpty);
  });

  testWidgets('submit valid membuat member dengan HP ternormalisasi',
      (tester) async {
    _useTallViewport(tester);
    final repo = FakeCrudRepository<Member>();
    addTearDown(repo.dispose);
    await tester.pumpWidget(_host(repo));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('name')), 'Budi Santoso');
    await tester.enterText(find.byKey(const Key('phone')), '0812-3456-7890');
    await tester.enterText(find.byKey(const Key('address')), 'Jl. Melati 3');

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(repo.created, hasLength(1));
    final created = repo.created.single;
    expect(created.name, 'Budi Santoso');
    expect(created.phone, '+6281234567890');
    expect(created.address, 'Jl. Melati 3');
    expect(created.customerType, 'rumah');
    expect(created.memberSince, isNull);
    expect(created.totalAcUnits, 0);
    expect(created.active, isTrue);
    expect(created.id, '');
  });

  testWidgets('HP duplikat (setelah normalisasi) ditolak', (tester) async {
    _useTallViewport(tester);
    final repo = FakeCrudRepository<Member>(seed: [
      const MapEntry(
        'm1',
        Member(
          id: 'm1',
          name: 'Lama',
          phone: '+6281234567890',
          address: '',
          customerType: 'rumah',
        ),
      ),
    ]);
    addTearDown(repo.dispose);
    await tester.pumpWidget(_host(repo));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('name')), 'Baru');
    await tester.enterText(find.byKey(const Key('phone')), '0812 3456 7890');

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(find.text('Nomor HP sudah terdaftar'), findsOneWidget);
    expect(repo.created, isEmpty);
  });
}
