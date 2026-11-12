import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/member.dart';
import 'package:epos_ac/features/members/legacy_import_screen.dart';
import 'package:epos_ac/features/members/member_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

String? _validate({
  bool existing = false,
  String? memberId,
  String name = 'Sari',
  String address = '',
  String? memberAddress,
  List<LegacyUnitInput> units = const [],
  bool invoice = false,
  DateTime? date,
  List<LegacyItemInput> items = const [],
  num discount = 0,
  num paid = 0,
}) =>
    validateLegacy(
      existingMember: existing,
      memberId: memberId,
      name: name,
      address: address,
      memberAddress: memberAddress,
      units: units,
      withInvoice: invoice,
      invDate: date,
      items: items,
      discount: discount,
      paid: paid,
    );

void main() {
  group('validateLegacy', () {
    test('member lama harus dipilih; member baru harus bernama', () {
      expect(_validate(existing: true), contains('Pilih member'));
      expect(_validate(name: ' '), contains('Nama member'));
    });

    test('tanpa unit dan tanpa transaksi ditolak', () {
      expect(_validate(), contains('minimal satu unit'));
    });

    test('QR dulu butuh alamat (alamat member lama ikut dihitung)', () {
      final qr = [LegacyUnitInput(qrDulu: true)];
      expect(_validate(units: qr), contains('"QR dulu"'));
      expect(_validate(units: qr, address: 'Jl. A'), isNull);
      expect(_validate(existing: true, memberId: 'm1', memberAddress: 'Jl. B', units: qr), isNull);
    });

    test('unit diketahui butuh merk atau model; PK angka; siklus 7..730', () {
      expect(_validate(units: [LegacyUnitInput()]), contains('merk atau model'));
      expect(_validate(units: [LegacyUnitInput(brand: 'Daikin', pk: 'x')]), contains('PK harus angka'));
      expect(_validate(units: [LegacyUnitInput(brand: 'Daikin', intervalDays: '3')]), contains('minimal 7'));
      expect(_validate(units: [LegacyUnitInput(brand: 'Daikin', pk: '1,5', intervalDays: '180')]), isNull);
    });

    test('transaksi: tanggal, item, dan dibayar tidak melebihi total', () {
      final items = [LegacyItemInput(name: 'Cuci AC', qty: '2', unitPrice: '100000')];
      expect(_validate(invoice: true, items: items), contains('Tanggal'));
      expect(_validate(invoice: true, date: DateTime(2025, 1, 1), items: [LegacyItemInput()]), contains('minimal satu item'));
      expect(_validate(invoice: true, date: DateTime(2025, 1, 1), items: items, discount: 50000, paid: 160000),
          contains('tidak boleh melebihi'));
      expect(_validate(invoice: true, date: DateTime(2025, 1, 1), items: items, discount: 50000, paid: 150000), isNull);
    });
  });

  test('buildLegacyPayload: member baru, unit diketahui + QR dulu, transaksi', () {
    final p = buildLegacyPayload(
      existingMember: false,
      name: ' Sari ',
      phone: '',
      address: 'Jl. A',
      units: [
        LegacyUnitInput(brand: 'Daikin', pk: '1,5', room: 'Kamar', intervalDays: '180', lastServiceDate: DateTime(2026, 5, 1)),
        LegacyUnitInput(qrDulu: true, room: 'Dapur', brand: 'abaikan'),
      ],
      withInvoice: true,
      invDate: DateTime(2025, 12, 3),
      items: [LegacyItemInput(name: 'Cuci AC', qty: '2', unitPrice: '100000'), LegacyItemInput()],
      discount: 50000,
      paid: 150000,
    );
    expect(p['member'], {'name': 'Sari', 'address': 'Jl. A'});
    expect(p['units'], [
      {'mode': 'diketahui', 'roomLocation': 'Kamar', 'brand': 'Daikin', 'pk': 1.5, 'lastServiceDate': '2026-05-01', 'serviceIntervalDays': 180},
      {'mode': 'qr_dulu', 'roomLocation': 'Dapur'},
    ]);
    expect(p['invoice'], {
      'date': '2025-12-03',
      'items': [
        {'name': 'Cuci AC', 'qty': 2, 'unitPrice': 100000},
      ],
      'discount': 50000,
      'totalPaid': 150000,
    });
  });

  test('buildLegacyPayload: member lama hanya memberId (+ alamat bila diisi)', () {
    final p = buildLegacyPayload(existingMember: true, memberId: 'm1', units: [LegacyUnitInput(qrDulu: true)]);
    expect(p['member'], {'memberId': 'm1'});
    expect(p.containsKey('invoice'), isFalse);
  });

  testWidgets('member baru + satu unit QR dulu: simpan memanggil /legacy-import lalu tampil hasil', (t) async {
    t.view.physicalSize = const Size(800, 2400);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final sent = <Map<String, dynamic>>[];
    await t.pumpWidget(ProviderScope(
      overrides: [
        membersStreamProvider.overrideWith((ref) => Stream.value(const <Member>[])),
        legacyImportCallerProvider.overrideWithValue((p) async {
          sent.add(p);
          return LegacyImportResult({
            'member': {'name': 'Sari'},
            'memberIsNew': true,
            'units': [
              {'id': 'u1'},
            ],
          });
        }),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const LegacyImportScreen()),
    ));
    await t.pumpAndSettle();

    await t.tap(find.text('Member baru'));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('legacy-name')), 'Sari');
    await t.enterText(find.byKey(const Key('legacy-address')), 'Jl. A');
    await t.tap(find.byKey(const Key('legacy-add-unit')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('legacy-unit-qr-0')));
    await t.pumpAndSettle();
    await t.ensureVisible(find.byKey(const Key('legacy-submit')));
    await t.tap(find.byKey(const Key('legacy-submit')));
    await t.pumpAndSettle();

    expect(sent.single['member'], {'name': 'Sari', 'address': 'Jl. A'});
    expect((sent.single['units'] as List).single['mode'], 'qr_dulu');
    expect(find.text('Tersimpan: Sari'), findsOneWidget);
    expect(find.byKey(const Key('legacy-print-labels')), findsOneWidget);
  });

  testWidgets('validasi gagal: tidak memanggil server', (t) async {
    t.view.physicalSize = const Size(800, 2400);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final sent = <Map<String, dynamic>>[];
    await t.pumpWidget(ProviderScope(
      overrides: [
        membersStreamProvider.overrideWith((ref) => Stream.value(const <Member>[])),
        legacyImportCallerProvider.overrideWithValue((p) async {
          sent.add(p);
          return LegacyImportResult({});
        }),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const LegacyImportScreen()),
    ));
    await t.pumpAndSettle();
    await t.ensureVisible(find.byKey(const Key('legacy-submit')));
    await t.tap(find.byKey(const Key('legacy-submit')));
    await t.pumpAndSettle();
    expect(sent, isEmpty);
    expect(find.textContaining('Pilih member dulu'), findsOneWidget);
  });
}
