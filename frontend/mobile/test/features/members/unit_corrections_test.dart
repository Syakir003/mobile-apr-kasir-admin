import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/features/members/unit_corrections_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _json() => {
      'id': 'c1',
      'status': 'pending',
      'brand': 'Daikin',
      'model': null,
      'pk': '1.50',
      'roomLocation': null,
      'serialNumber': null,
      'installationDate': '2026-10-02T00:00:00.000Z',
      'note': 'Salah tulis merk',
      'reviewNote': null,
      'createdAt': '2026-11-10T03:00:00.000Z',
      'requestedBy': {'displayName': 'Andi'},
      'reviewedBy': null,
      'unit': {
        'id': 'u1',
        'barcodeValue': 'AC-001',
        'brand': 'Dakin',
        'model': 'FTV',
        'pk': '1',
        'roomLocation': 'Kamar',
        'serialNumber': null,
        'installationDate': null,
        'member': {'name': 'Budi', 'address': 'Jl A'},
      },
    };

Widget _app(List<(String, bool, String?)> calls) => ProviderScope(
      overrides: [
        unitCorrectionsProvider.overrideWith((ref, s) => Future.value(s == 'pending' ? [UnitCorrection(_json())] : [])),
        reviewCorrectionCallerProvider.overrideWithValue((id, {required approve, reason}) async {
          calls.add((id, approve, reason));
        }),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const UnitCorrectionsScreen()),
    );

void main() {
  test('diffRows hanya memuat field yang diusulkan, dengan nilai lama', () {
    final rows = diffRows(_json());
    expect(rows.map((r) => r.label), ['Merk', 'PK', 'Tgl pasang']);
    expect(rows[0], (label: 'Merk', oldValue: 'Dakin', newValue: 'Daikin'));
    expect(rows[1], (label: 'PK', oldValue: '1', newValue: '1.5'));
    expect(rows[2].newValue, '02-10-2026');
    expect(rows[2].oldValue, '-');
  });

  testWidgets('setujui memanggil approve tanpa alasan', (t) async {
    final calls = <(String, bool, String?)>[];
    await t.pumpWidget(_app(calls));
    await t.pumpAndSettle();
    expect(find.text('Budi'), findsOneWidget);
    await t.tap(find.byKey(const Key('approve-c1')));
    await t.pumpAndSettle();
    expect(calls.single, ('c1', true, null));
  });

  testWidgets('tolak wajib alasan: tombol mati sampai diisi, lalu kirim reject', (t) async {
    final calls = <(String, bool, String?)>[];
    await t.pumpWidget(_app(calls));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('reject-c1')));
    await t.pumpAndSettle();
    expect(t.widget<FilledButton>(find.byKey(const Key('reject-confirm'))).onPressed, isNull);
    await t.enterText(find.byKey(const Key('reject-reason')), ' Data sudah benar ');
    await t.pump();
    await t.tap(find.byKey(const Key('reject-confirm')));
    await t.pumpAndSettle();
    expect(calls.single, ('c1', false, 'Data sudah benar'));
  });
}
