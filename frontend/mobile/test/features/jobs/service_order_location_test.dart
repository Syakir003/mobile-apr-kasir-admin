import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/models/member.dart';
import 'package:epos_ac/features/jobs/service_order_create_screen.dart';
import 'package:epos_ac/features/members/member_providers.dart';
import 'package:epos_ac/features/pos/pos_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _app(List<Member> members) => ProviderScope(
      overrides: [
        membersStreamProvider.overrideWith((ref) => Stream.value(members)),
        memberUnitsProvider.overrideWith((ref, id) => Stream.value(const <AcUnit>[])),
        techniciansProvider.overrideWith((ref) => Stream.value(<({String uid, String name})>[])),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const ServiceOrderCreateScreen(initialMemberId: 'm1')),
    );

void main() {
  void tall(WidgetTester t) {
    t.view.physicalSize = const Size(900, 3200);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
  }

  testWidgets('Samakan dengan alamat pelanggan: menyalin alamat + link Maps member ke titik lokasi', (t) async {
    tall(t);
    await t.pumpWidget(_app(const [
      Member(
        id: 'm1',
        name: 'Bp. Imam',
        phone: '0812',
        address: 'Jl. Mawar 1, Mojosari, Kabupaten Mojokerto',
        mapsUrl: 'https://maps.app.goo.gl/abc',
        customerType: 'retail',
      ),
    ]));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const Key('order-loc-copy-0')));
    await t.pumpAndSettle();

    expect(t.widget<TextField>(find.byKey(const Key('order-loc-address-0'))).controller!.text,
        'Jl. Mawar 1, Mojosari, Kabupaten Mojokerto');
    expect(t.widget<TextField>(find.byKey(const Key('order-loc-maps-0'))).controller!.text,
        'https://maps.app.goo.gl/abc');
    expect(find.textContaining('Dikosongkan = ikut alamat utama pelanggan'), findsOneWidget);
  });

  testWidgets('tanpa alamat pelanggan: tidak menyalin, memberi tahu', (t) async {
    tall(t);
    await t.pumpWidget(_app(const [
      Member(id: 'm1', name: 'Bp. Imam', phone: '0812', address: '', customerType: 'retail'),
    ]));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const Key('order-loc-copy-0')));
    await t.pump();

    expect(t.widget<TextField>(find.byKey(const Key('order-loc-address-0'))).controller!.text, isEmpty);
    expect(find.textContaining('Alamat pelanggan belum ada'), findsOneWidget);
  });
}
