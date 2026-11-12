import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:epos_ac/features/jobs/material_requests_admin_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _json({String status = 'pending'}) => {
      'items': [
        {
          'id': 'abcdef1234567890',
          'jobId': 'job1',
          'status': status,
          'total': '200000.00',
          'note': 'Pipa kurang',
          'decisionNote': null,
          'createdAt': '2026-11-10T03:00:00.000Z',
          'decidedAt': null,
          'usedAt': null,
          'usedNote': null,
          'items': [
            {
              'id': 'i1',
              'kind': 'sparepart',
              'refId': 'sp1',
              'name': 'Pipa AC',
              'unit': 'm',
              'qty': '4',
              'qtyUsed': null,
              'unitPrice': 50000,
              'lineTotal': 200000,
            },
          ],
          'job': {
            'id': 'job1',
            'type': 'perbaikan',
            'unit': {'brand': 'Daikin', 'model': 'FTV', 'barcodeValue': 'X'},
            'member': {'name': 'Budi'},
          },
          'createdBy': {'id': 't1', 'displayName': 'Andi Teknisi'},
        },
      ],
      'counts': {'all': 3, 'pending': 1, 'approved': 1, 'rejected': 1},
    };

Widget _app(List<Map<String, dynamic>> sent) => ProviderScope(
      overrides: [
        adminMaterialRequestsProvider.overrideWith(
          (ref, status) => Future.value(AdminMaterialRequestList.fromNest(_json())),
        ),
        decideRequestCallerProvider.overrideWithValue((p) async => sent.add(p)),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const MaterialRequestsAdminScreen()),
    );

void main() {
  test('fromNest membaca konteks job/teknisi/pelanggan dan hitungan status', () {
    final l = AdminMaterialRequestList.fromNest(_json());
    final r = l.items.single;
    expect(r.technicianName, 'Andi Teknisi');
    expect(r.jobLabel, 'Daikin FTV');
    expect(r.memberName, 'Budi');
    expect(r.request.jobId, 'job1');
    expect(r.request.total, 200000);
    expect(r.request.items.single.refId, 'sp1');
    expect(l.counts, {'all': 3, 'pending': 1, 'approved': 1, 'rejected': 1});
  });

  testWidgets('daftar tampil dengan hitungan di chip; Setujui mengirim keputusan approve', (t) async {
    final sent = <Map<String, dynamic>>[];
    await t.pumpWidget(_app(sent));
    await t.pumpAndSettle();

    expect(find.text('Menunggu (1)'), findsOneWidget);
    expect(find.text('Andi Teknisi'), findsOneWidget);

    await t.tap(find.byKey(const Key('material-request-abcdef1234567890')));
    await t.pumpAndSettle();
    expect(find.text('REQ-ABCDEF12'), findsOneWidget);

    await t.tap(find.byKey(const Key('request-approve')));
    await t.pumpAndSettle();
    expect(sent.single, {'requestId': 'abcdef1234567890', 'decision': 'approve'});
  });

  testWidgets('Revisi mengirim daftar pengganti {kind, refId, qty}; item qty 0 dibuang', (t) async {
    final sent = <Map<String, dynamic>>[];
    await t.pumpWidget(_app(sent));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('material-request-abcdef1234567890')));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const Key('request-revise')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('revise-qty-0')), '2,5');
    await t.tap(find.byKey(const Key('request-save-revision')));
    await t.pumpAndSettle();

    expect(sent.single['decision'], 'revise');
    expect(sent.single['items'], [
      {'kind': 'sparepart', 'refId': 'sp1', 'qty': 2.5},
    ]);
  });
}
