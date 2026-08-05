import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/models/member.dart';
import 'package:epos_ac/features/members/member_providers.dart';
import 'package:epos_ac/features/pos/cart_state.dart';
import 'package:epos_ac/features/pos/checkout_screen.dart';
import 'package:epos_ac/features/pos/pos_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../../support/fake_ac_unit_repository.dart';
import '../../support/fake_crud_repository.dart';

/// Notifier yang mem-build state awal dari [seed] — dipakai untuk
/// men-seed keranjang lewat override provider pada widget test
/// (`cartProvider.overrideWith(() => _SeededCartNotifier(seed))`).
class _SeededCartNotifier extends CartNotifier {
  _SeededCartNotifier(this.seed);

  final Cart seed;

  @override
  Cart build() => seed;
}

Widget _host({
  required Cart seed,
  required Future<({String invoiceId, String invoiceNumber})> Function(
          Map<String, dynamic>)
      caller,
  FakeCrudRepository<Member>? memberRepo,
  FakeAcUnitRepository? unitRepo,
}) {
  final router = GoRouter(
    initialLocation: '/pos/checkout',
    routes: [
      GoRoute(
        path: '/pos/checkout',
        builder: (_, __) => const CheckoutScreen(),
      ),
      GoRoute(
        path: '/transactions/:id',
        builder: (_, state) =>
            Scaffold(body: Text('detail-${state.pathParameters['id']}')),
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      cartProvider.overrideWith(() => _SeededCartNotifier(seed)),
      checkoutCallerProvider.overrideWithValue(caller),
      if (memberRepo != null)
        memberRepositoryProvider.overrideWithValue(memberRepo),
      if (unitRepo != null) acUnitRepositoryProvider.overrideWithValue(unitRepo),
      techniciansProvider.overrideWith((ref) => Stream.value(const [])),
    ],
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
  testWidgets('submit kosong menampilkan error validasi, caller tidak terpanggil',
      (tester) async {
    _useTallViewport(tester);
    var called = false;
    await tester.pumpWidget(_host(
      seed: const Cart(),
      caller: (payload) async {
        called = true;
        return (invoiceId: 'inv1', invoiceNumber: 'INV-X');
      },
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(find.text('Wajib diisi'), findsWidgets);
    expect(called, isFalse);
  });

  testWidgets(
      'submit valid mengirim payload dengan HP ternormalisasi & installations benar, lalu navigasi ke detail',
      (tester) async {
    _useTallViewport(tester);
    Map<String, dynamic>? capturedPayload;
    const seed = Cart(
      lines: [
        CartLine(
          kind: CartItemKind.product,
          refId: 'p1',
          name: 'AC Split 1 PK',
          unit: 'unit',
          unitPrice: 3500000,
          qty: 2,
          withInstallation: true,
          roomLocation: 'Ruang tamu',
          technicianId: 't1',
        ),
        CartLine(
          kind: CartItemKind.service,
          refId: 's1',
          name: 'Cuci AC',
          unit: 'jasa',
          unitPrice: 75000,
          qty: 1,
        ),
      ],
    );

    await tester.pumpWidget(_host(
      seed: seed,
      caller: (payload) async {
        capturedPayload = payload;
        return (invoiceId: 'inv-123', invoiceNumber: 'INV-20260712-0001');
      },
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('name')), 'Budi Santoso');
    await tester.enterText(find.byKey(const Key('phone')), '0812-3456-7890');

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(capturedPayload, isNotNull);
    final payload = capturedPayload!;
    expect(payload['customer'], containsPair('phone', '+6281234567890'));
    expect(payload['customer'], containsPair('name', 'Budi Santoso'));
    expect(payload['items'], [
      {'kind': 'product', 'refId': 'p1', 'qty': 2},
      {'kind': 'service', 'refId': 's1', 'qty': 1},
    ]);
    final installations = payload['installations'] as List;
    expect(installations, hasLength(2));
    for (final inst in installations) {
      expect(inst, {
        'itemIndex': 0,
        'roomLocation': 'Ruang tamu',
        'technicianId': 't1',
      });
    }

    expect(find.text('detail-inv-123'), findsOneWidget);
  });

  testWidgets(
      'pilih member mengisi data pelanggan, mengunci nama/HP, dan payload memakai nomor member',
      (tester) async {
    _useTallViewport(tester);
    Map<String, dynamic>? capturedPayload;
    final memberRepo = FakeCrudRepository<Member>(seed: [
      const MapEntry(
        'm1',
        Member(
          id: 'm1',
          name: 'Siti Aminah',
          phone: '+6281200001111',
          address: 'Jl. Melati 7',
          customerType: 'rumah',
          totalAcUnits: 3,
        ),
      ),
      const MapEntry(
        'm2',
        Member(
          id: 'm2',
          name: 'Member Nonaktif',
          phone: '+6281299998888',
          address: '',
          customerType: 'lainnya',
          active: false,
        ),
      ),
    ]);
    addTearDown(memberRepo.dispose);

    await tester.pumpWidget(_host(
      // Baris sparepart: fokus test ini pada data pelanggan, bukan unit jasa
      // (pemilihan unit diuji terpisah di bawah).
      seed: const Cart(
        lines: [
          CartLine(
            kind: CartItemKind.sparepart,
            refId: 'sp1',
            name: 'Freon R32',
            unit: 'kg',
            unitPrice: 75000,
            qty: 1,
          ),
        ],
      ),
      caller: (payload) async {
        capturedPayload = payload;
        return (invoiceId: 'inv-9', invoiceNumber: 'INV-9');
      },
      memberRepo: memberRepo,
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('pick-member')));
    await tester.pumpAndSettle();

    // Member nonaktif tidak boleh muncul di daftar pilihan.
    expect(find.text('Member Nonaktif'), findsNothing);

    await tester.tap(find.byKey(const Key('member-m1')));
    await tester.pumpAndSettle();

    expect(find.text('Siti Aminah'), findsWidgets);
    expect(_fieldOf(tester, 'name').controller?.text, 'Siti Aminah');
    expect(_fieldOf(tester, 'phone').controller?.text, '+6281200001111');
    expect(_fieldOf(tester, 'address').controller?.text, 'Jl. Melati 7');
    // Nama & HP dikunci; alamat tetap bisa disesuaikan per transaksi.
    expect(_fieldOf(tester, 'name').readOnly, isTrue);
    expect(_fieldOf(tester, 'phone').readOnly, isTrue);
    expect(_fieldOf(tester, 'address').readOnly, isFalse);

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(capturedPayload, isNotNull);
    expect(capturedPayload!['customer'], {
      'name': 'Siti Aminah',
      'phone': '+6281200001111',
      'address': 'Jl. Melati 7',
    });
  });

  testWidgets('lepas member mengosongkan data pelanggan & membuka kunci',
      (tester) async {
    _useTallViewport(tester);
    final memberRepo = FakeCrudRepository<Member>(seed: [
      const MapEntry(
        'm1',
        Member(
          id: 'm1',
          name: 'Siti Aminah',
          phone: '+6281200001111',
          address: 'Jl. Melati 7',
          customerType: 'rumah',
        ),
      ),
    ]);
    addTearDown(memberRepo.dispose);

    await tester.pumpWidget(_host(
      seed: const Cart(),
      caller: (payload) async => (invoiceId: 'x', invoiceNumber: 'X'),
      memberRepo: memberRepo,
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('pick-member')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('member-m1')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('clear-member')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('pick-member')), findsOneWidget);
    expect(_fieldOf(tester, 'name').controller?.text, isEmpty);
    expect(_fieldOf(tester, 'phone').controller?.text, isEmpty);
    expect(_fieldOf(tester, 'name').readOnly, isFalse);
    expect(_fieldOf(tester, 'phone').readOnly, isFalse);
  });

  testWidgets(
      'baris jasa: unit member muncul setelah member dipilih, terpilih sebanyak qty & terkirim sebagai serviceUnits',
      (tester) async {
    _useTallViewport(tester);
    Map<String, dynamic>? capturedPayload;
    final memberRepo = _memberRepo();
    final unitRepo = _unitRepo();
    addTearDown(memberRepo.dispose);
    addTearDown(unitRepo.dispose);

    await tester.pumpWidget(_host(
      seed: const Cart(lines: [_cuciLine]),
      caller: (payload) async {
        capturedPayload = payload;
        return (invoiceId: 'inv-7', invoiceNumber: 'INV-7');
      },
      memberRepo: memberRepo,
      unitRepo: unitRepo,
    ));
    await tester.pumpAndSettle();

    // Sebelum member dipilih, bagian unit belum ada.
    expect(find.byKey(const Key('service-units-0')), findsNothing);

    await tester.tap(find.byKey(const Key('pick-member')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('member-m1')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('service-units-0')), findsOneWidget);
    expect(find.text('0/2 unit'), findsOneWidget);
    // Hanya unit milik member terpilih.
    expect(find.byKey(const Key('unit-0-u1')), findsOneWidget);
    expect(find.byKey(const Key('unit-0-u2')), findsOneWidget);
    expect(find.byKey(const Key('unit-0-u9')), findsNothing);

    // Belum lengkap: submit ditolak, caller tidak terpanggil.
    await tester.tap(find.byKey(const Key('unit-0-u1')));
    await tester.pumpAndSettle();
    expect(find.text('1/2 unit'), findsOneWidget);
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(capturedPayload, isNull);
    expect(find.textContaining('Pilih unit AC sesuai qty'), findsOneWidget);

    await tester.tap(find.byKey(const Key('unit-0-u2')));
    await tester.pumpAndSettle();
    expect(find.text('2/2 unit'), findsOneWidget);

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(capturedPayload, isNotNull);
    expect(capturedPayload!['serviceUnits'], [
      {'itemIndex': 0, 'unitId': 'u1'},
      {'itemIndex': 0, 'unitId': 'u2'},
    ]);
  });

  testWidgets('unit ketiga terkunci setelah qty jasa terpenuhi',
      (tester) async {
    _useTallViewport(tester);
    final memberRepo = _memberRepo();
    final unitRepo = _unitRepo();
    addTearDown(memberRepo.dispose);
    addTearDown(unitRepo.dispose);

    await tester.pumpWidget(_host(
      seed: const Cart(lines: [_cuciLine]),
      caller: (payload) async => (invoiceId: 'x', invoiceNumber: 'X'),
      memberRepo: memberRepo,
      unitRepo: unitRepo,
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('pick-member')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('member-m1')));
    await tester.pumpAndSettle();

    // qty 1: unit kedua terkunci setelah unit pertama dipilih.
    ProviderScope.containerOf(tester.element(find.byType(CheckoutScreen)))
        .read(cartProvider.notifier)
        .setQty(0, 1);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('unit-0-u1')));
    await tester.pumpAndSettle();

    final locked = tester.widget<CheckboxListTile>(
      find.byKey(const Key('unit-0-u2')),
    );
    expect(locked.onChanged, isNull);
    expect(find.text('1/1 unit'), findsOneWidget);
  });
}

/// Member + dua unit AC miliknya, dipakai test pemilihan unit jasa.
const _member = Member(
  id: 'm1',
  name: 'Siti Aminah',
  phone: '+6281200001111',
  address: 'Jl. Melati 7',
  customerType: 'rumah',
  totalAcUnits: 2,
);

const _cuciLine = CartLine(
  kind: CartItemKind.service,
  refId: 's1',
  name: 'Cuci AC 1 PK',
  unit: 'jasa',
  unitPrice: 65000,
  qty: 2,
);

FakeAcUnitRepository _unitRepo() => FakeAcUnitRepository(seed: [
      const MapEntry(
        'u1',
        AcUnit(
          memberId: 'm1',
          brand: 'Daikin',
          model: 'FTV25',
          pk: 1,
          roomLocation: 'Kamar 1',
          barcodeValue: 'ACUNIT-1',
          status: AcUnitStatus.aktif,
        ),
      ),
      const MapEntry(
        'u2',
        AcUnit(
          memberId: 'm1',
          brand: 'Daikin',
          model: 'FTV35',
          pk: 1.5,
          roomLocation: 'Kamar 2',
          barcodeValue: 'ACUNIT-2',
          status: AcUnitStatus.aktif,
        ),
      ),
      // Unit member lain: tidak boleh muncul di daftar.
      const MapEntry(
        'u9',
        AcUnit(
          memberId: 'm2',
          brand: 'LG',
          model: 'Dualcool',
          pk: 1,
          roomLocation: 'Ruang Tamu',
          status: AcUnitStatus.aktif,
        ),
      ),
    ]);

FakeCrudRepository<Member> _memberRepo() =>
    FakeCrudRepository<Member>(seed: const [MapEntry('m1', _member)]);

/// TextField di dalam TextFormField ber-[key] — untuk memeriksa isi controller
/// dan status `readOnly`.
TextField _fieldOf(WidgetTester tester, String key) {
  return tester.widget<TextField>(
    find.descendant(
      of: find.byKey(Key(key)),
      matching: find.byType(TextField),
    ),
  );
}
