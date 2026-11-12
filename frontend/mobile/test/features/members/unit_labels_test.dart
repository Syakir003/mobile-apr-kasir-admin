import 'package:epos_ac/core/router/app_router.dart' show currentUserProvider;
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/features/members/unit_label_pdf.dart';
import 'package:epos_ac/features/members/unit_labels_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _row(String id, {String status = 'aktif', String? printed, String? attached}) => {
      'id': id,
      'barcodeValue': 'ACUNIT-$id',
      'status': status,
      'brand': status == 'aktif' ? 'Daikin' : null,
      'model': status == 'aktif' ? 'FTV' : null,
      'pk': '1.50',
      'roomLocation': 'Kamar',
      'labelPrintedAt': printed,
      'labelAttachedAt': attached,
      'member': {'id': 'm1', 'name': 'Budi', 'phone': '08', 'address': 'Jl. A'},
    };

LabelList _list() => LabelList({
      'counts': {'belumDicetak': 2, 'belumDitempel': 3, 'menungguData': 1},
      'total': 2,
      'items': [
        _row('u1'),
        _row('u2', status: 'menunggu_data', printed: '2026-11-01T00:00:00.000Z'),
      ],
    });

Widget _app(List<List<String>> marks, List<int> printed, {UserRole role = UserRole.admin, bool printOk = true}) => ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => Stream.value(AppUser(uid: 'a', email: 'e', displayName: 'A', role: role))),
        unitLabelsProvider.overrideWith((ref, k) => Future.value(_list())),
        printLabelsProvider.overrideWithValue((rows) async {
          printed.add(rows.length);
          return printOk;
        }),
        markLabelsProvider.overrideWithValue((ids, {required attached}) async {
          marks.add([attached ? 'attached' : 'printed', ...ids]);
        }),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const UnitLabelsScreen()),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('LabelRow: status label, unit QR dulu memuat nama + alamat di label', () {
    final l = _list();
    expect(l.items[0].labelState, 'Belum dicetak');
    expect(l.items[1].labelState, 'Sudah dicetak');
    expect(l.items[0].extraLines, isEmpty);
    expect(l.items[1].extraLines, ['Budi', 'Jl. A']);
    expect(l.items[0].toUnit().pk, 1.5);
  });

  test('PDF multi-halaman dibangun, dengan baris tambahan', () async {
    const u = AcUnit(id: 'u1', memberId: 'm', brand: 'A', model: 'B', pk: 1, roomLocation: 'K', barcodeValue: 'ACUNIT-1');
    final one = await buildUnitLabelsPdf([u]);
    final three = await buildUnitLabelsPdf([u, u, u], extraLines: {'u1': ['Budi', 'Jl. A']});
    expect(three.length, greaterThan(one.length));
  });

  testWidgets('cetak: pilih baris, cetak, lalu ditandai dicetak hanya bila benar-benar tercetak', (t) async {
    final marks = <List<String>>[];
    final printed = <int>[];
    await t.pumpWidget(_app(marks, printed));
    await t.pumpAndSettle();
    expect(find.textContaining('Belum dicetak 2'), findsOneWidget);

    FilledButton btn(String k) => t.widget<FilledButton>(find.byKey(Key(k)));
    expect(btn('label-print').onPressed, isNull);
    await t.tap(find.byKey(const Key('label-pick-all')));
    await t.pumpAndSettle();
    expect(find.text('Cetak (2)'), findsOneWidget);
    await t.tap(find.byKey(const Key('label-print')));
    await t.pumpAndSettle();
    expect(printed, [2]);
    expect(marks, [
      ['printed', 'u1', 'u2'],
    ]);
  });

  testWidgets('dibatalkan di dialog cetak: tidak ditandai', (t) async {
    final marks = <List<String>>[];
    final printed = <int>[];
    await t.pumpWidget(_app(marks, printed, printOk: false));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('label-row-u1')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('label-print')));
    await t.pumpAndSettle();
    expect(printed, [1]);
    expect(marks, isEmpty);
  });

  testWidgets('Sudah ditempel hanya untuk admin', (t) async {
    final marks = <List<String>>[];
    await t.pumpWidget(_app(marks, [], role: UserRole.admin));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('label-row-u2')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('label-attach')));
    await t.pumpAndSettle();
    expect(marks, [
      ['attached', 'u2'],
    ]);
  });

  testWidgets('kasir tidak melihat tombol Sudah ditempel', (t) async {
    await t.pumpWidget(_app([], [], role: UserRole.kasir));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('label-attach')), findsNothing);
    expect(find.byKey(const Key('label-print')), findsOneWidget);
  });
}
