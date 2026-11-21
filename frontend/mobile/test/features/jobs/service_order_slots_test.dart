import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/models/member.dart';
import 'package:epos_ac/features/jobs/service_order_create_screen.dart';
import 'package:epos_ac/features/members/member_providers.dart';
import 'package:epos_ac/features/pos/pos_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _app({required List<AcUnit> units}) => ProviderScope(
      overrides: [
        membersStreamProvider.overrideWith((ref) => Stream.value(const [
              Member(id: 'm1', name: 'Pabrik Maju', phone: '0812', address: 'Jl. A', customerType: 'retail'),
            ])),
        memberUnitsProvider.overrideWith((ref, id) => Stream.value(units)),
        techniciansProvider.overrideWith((ref) => Stream.value(<({String uid, String name})>[])),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const ServiceOrderCreateScreen(initialMemberId: 'm1')),
    );

const _unit = AcUnit(
  id: 'u1',
  memberId: 'm1',
  brand: 'LG',
  model: 'Dualcool',
  pk: 1,
  roomLocation: 'Lantai 1',
  barcodeValue: 'BC1',
  status: AcUnitStatus.aktif,
);

void main() {
  void tall(WidgetTester t) {
    t.view.physicalSize = const Size(900, 3600);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
  }

  testWidgets('member punya unit: kartu "teknisi yang scan" tampil; stepper menambah dan menjumlah ke tombol Buat Order',
      (t) async {
    tall(t);
    await t.pumpWidget(_app(units: const [_unit]));
    await t.pumpAndSettle();

    expect(find.byKey(const Key('order-scan-slots')), findsOneWidget);
    expect(find.text('Jumlah unit, teknisi yang scan'), findsOneWidget);
    expect(t.widget<Text>(find.byKey(const Key('order-scan-slots-count'))).data, '0');
    // Kurangi dinonaktifkan di 0.
    expect(t.widget<IconButton>(find.byKey(const Key('order-scan-slots-minus'))).onPressed, isNull);

    for (var i = 0; i < 3; i++) {
      await t.tap(find.byKey(const Key('order-scan-slots-plus')));
      await t.pump();
    }
    expect(t.widget<Text>(find.byKey(const Key('order-scan-slots-count'))).data, '3');
    expect(find.text('Buat Order (3 unit)'), findsOneWidget);

    await t.tap(find.byKey(const Key('order-scan-slots-minus')));
    await t.pump();
    expect(find.text('Buat Order (2 unit)'), findsOneWidget);
  });

  testWidgets('total unit dibatasi 20: slot maksimum berkurang saat unit baru ditambah', (t) async {
    tall(t);
    await t.pumpWidget(_app(units: const [_unit]));
    await t.pumpAndSettle();
    expect(find.textContaining('(maks. 20)'), findsOneWidget);

    await t.ensureVisible(find.byKey(const Key('order-add-unit')));
    await t.tap(find.byKey(const Key('order-add-unit')));
    await t.pumpAndSettle();
    expect(find.textContaining('(maks. 19)'), findsOneWidget);
  });

  testWidgets('member tanpa unit: kartu tidak tampil (unit yang discan harus milik pelanggan)', (t) async {
    tall(t);
    await t.pumpWidget(_app(units: const []));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('order-scan-slots')), findsNothing);
  });
}
