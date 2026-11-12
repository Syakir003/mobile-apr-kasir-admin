import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:epos_ac/features/jobs/service_order_create_screen.dart';
import 'package:epos_ac/features/members/member_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final tgl = DateTime(2026, 11, 5);

  test('member lama + unit lama: customer hanya memberId, tanggal YYYY-MM-DD', () {
    final p = buildIntakePayload(
      memberId: 'm1',
      memberName: 'Budi',
      jobType: IntakeJobType.bongkarPasang,
      complaint: ' AC bocor ',
      scheduled: tgl,
      technicianIds: const ['t1', 't2'],
      existingUnitIds: const ['u1', 'u2'],
    );
    expect(p['customer'], {'name': 'Budi', 'memberId': 'm1'});
    expect(p['jobType'], 'bongkar_pasang');
    expect(p['complaint'], 'AC bocor');
    expect(p['scheduledDate'], '2026-11-05');
    expect(p['technicianIds'], ['t1', 't2']);
    expect(p['units'], [
      {'existingUnitId': 'u1'},
      {'existingUnitId': 'u2'},
    ]);
    expect(p.containsKey('workDescription'), isFalse);
  });

  test('pelanggan baru + unit baru; QR dulu hanya mengirim ruangan', () {
    final p = buildIntakePayload(
      name: ' Sari ',
      phone: '0855123',
      address: '',
      jobType: IntakeJobType.cuci,
      workDescription: 'Cuci semua unit',
      complaint: 'Cuci AC',
      scheduled: tgl,
      newUnits: [
        IntakeNewUnit(brand: 'Daikin', model: ' ', pk: 1.5, room: 'Kamar'),
        IntakeNewUnit(brand: 'abaikan', pk: 2, room: 'Ruang tamu', qrDulu: true),
      ],
    );
    expect(p['customer'], {'name': 'Sari', 'phone': '0855123'});
    expect(p['workDescription'], 'Cuci semua unit');
    expect(p['units'], [
      {
        'newUnit': {'brand': 'Daikin', 'pk': 1.5, 'roomLocation': 'Kamar'}
      },
      {
        'newUnit': {'qrDulu': true, 'roomLocation': 'Ruang tamu'}
      },
    ]);
  });

  group('titik lokasi kerja', () {
    Map<String, dynamic> build(List<IntakeLocation> locs, {Map<String, int> unitLoc = const {}, int newLoc = 0}) =>
        buildIntakePayload(
          memberId: 'm1',
          memberName: 'Budi',
          jobType: IntakeJobType.cuci,
          complaint: 'Cuci',
          scheduled: tgl,
          existingUnitIds: const ['u1', 'u2'],
          newUnits: [IntakeNewUnit(room: 'Dapur', locationIndex: newLoc)],
          locations: locs,
          unitLocation: unitLoc,
        );

    test('satu titik kosong: tidak ada locations/locationIndex (ikut alamat pelanggan)', () {
      final p = build([IntakeLocation()]);
      expect(p.containsKey('locations'), isFalse);
      expect((p['units'] as List).first, {'existingUnitId': 'u1'});
    });

    test('satu titik terisi: dikirim, semua unit ke titik 0', () {
      final p = build([IntakeLocation(address: ' Jl. Melati 5 ')]);
      expect(p['locations'], [
        {'address': 'Jl. Melati 5'},
      ]);
      expect((p['units'] as List).first, {'existingUnitId': 'u1', 'locationIndex': 0});
    });

    test('beberapa titik: tiap unit menunjuk titiknya, indeks liar dibatasi', () {
      final p = build(
        [IntakeLocation(address: 'A'), IntakeLocation(mapsUrl: 'https://maps.app/x')],
        unitLoc: {'u2': 1},
        newLoc: 9,
      );
      expect(p['locations'], [
        {'address': 'A'},
        {'mapsUrl': 'https://maps.app/x'},
      ]);
      final units = p['units'] as List;
      expect(units[0]['locationIndex'], 0);
      expect(units[1]['locationIndex'], 1);
      expect(units[2]['locationIndex'], 1); // 9 dibatasi ke titik terakhir
    });
  });

  testWidgets('pelanggan baru: tombol aktif hanya setelah ada unit, keluhan, dan jadwal', (t) async {
    await t.pumpWidget(ProviderScope(
      overrides: [
        membersStreamProvider.overrideWith((ref) => Stream.value(const [])),
        createServiceOrderCallerProvider.overrideWithValue((payload) async {}),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const ServiceOrderCreateScreen()),
    ));
    await t.pumpAndSettle();

    final list = find.byType(Scrollable).first;
    Future<void> show(Finder f) => t.scrollUntilVisible(f, 200, scrollable: list);
    FilledButton submit() => t.widget<FilledButton>(find.byKey(const Key('order-submit')));

    await t.tap(find.text('Pelanggan baru'));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('order-name')), 'Sari');
    await t.enterText(find.byKey(const Key('order-phone')), '0855123');
    await show(find.byKey(const Key('order-add-unit')));
    await t.tap(find.byKey(const Key('order-add-unit')));
    await t.pumpAndSettle();
    await show(find.byKey(const Key('order-complaint')));
    await t.enterText(find.byKey(const Key('order-complaint')), 'AC tidak dingin');
    await t.pump();
    await show(find.byKey(const Key('order-submit')));
    expect(submit().onPressed, isNull); // jadwal belum dipilih

    await show(find.byKey(const Key('order-date')));
    await t.tap(find.byKey(const Key('order-date')));
    await t.pumpAndSettle();
    await t.tap(find.text('OK'));
    await t.pumpAndSettle();
    await show(find.byKey(const Key('order-submit')));
    expect(submit().onPressed, isNotNull);
  });
}
