import 'dart:convert';

import 'package:epos_ac/core/auth/session_store.dart';
import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/features/master/master_providers.dart';
import 'package:epos_ac/features/master/sparepart/sparepart_list_screen.dart';
import 'package:epos_ac/features/stock/stock_opname_screen.dart';
import 'package:epos_ac/features/stock/stock_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// Gudang harus bisa membetulkan stok barang yang baru diinput (masih "menunggu harga").

const _gudang = AppUser(uid: 'g', email: 'e', displayName: 'G', role: UserRole.gudang);

void main() {
  test('daftar stok memuat barang aktif DAN menunggu harga, bukan yang dimatikan', () async {
    final previous = SessionStore.instance;
    addTearDown(() => SessionStore.instance = previous);
    SessionStore.instance = SessionStore(MemoryKeyValueStore());
    await SessionStore.instance.save('t', _gudang);
    final spareparts = [
      {'id': 'a', 'name': 'Aktif', 'stock': '1', 'active': true},
      {'id': 'b', 'name': 'Menunggu', 'stock': '50', 'active': false, 'pendingPrice': true, 'batchTracked': true},
      {'id': 'c', 'name': 'Dimatikan', 'stock': '3', 'active': false, 'pendingPrice': false},
    ];
    await http.runWithClient(() async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final sub = container.listen(stockOverviewProvider, (_, __) {});
      final data = await container.read(stockOverviewProvider.future);
      sub.close();
      expect(data.spareparts.map((r) => r.id).toSet(), {'a', 'b'});
      expect(data.spareparts.firstWhere((r) => r.id == 'b').active, isFalse);
    }, () => MockClient((request) async {
          final path = request.url.toString();
          expect(path.contains('/movements') || path.contains('status=all'), isTrue);
          return http.Response(jsonEncode(path.contains('/spareparts') ? spareparts : []), 200);
        }));
  });

  testWidgets('opname dibuka dari barang tertentu: sparepart sudah terpilih', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        stockOverviewProvider.overrideWith((ref) async => (
              products: <StockRow>[],
              spareparts: [const StockRow(id: 's1', kind: 'sparepart', name: 'Kapasitor', stock: 7)],
              movements: <MovementRow>[],
            )),
      ],
      child: const MaterialApp(home: StockOpnameScreen(initialItemId: 's1')),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('Kapasitor · stok 7'), findsOneWidget);
  });

  testWidgets('gudang mengetuk sparepart di daftar: membuka detailnya', (tester) async {
    Object? opened;
    final router = GoRouter(routes: [
      GoRoute(path: '/', builder: (_, __) => const SparepartListScreen()),
      GoRoute(
        path: '/stok/detail',
        builder: (_, state) {
          opened = (state.extra as StockRow).id;
          return const Scaffold(body: Text('detail'));
        },
      ),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => Stream.value(_gudang)),
        sparepartListProvider.overrideWith((ref) => Stream.value([
              Sparepart.fromMap('s9', {'name': 'Kapasitor', 'active': true, 'stock': '7', 'unit': 'pcs'}),
            ])),
      ],
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Kapasitor'));
    await tester.pumpAndSettle();
    expect(find.text('detail'), findsOneWidget);
    expect(opened, 's9');
  });
}
