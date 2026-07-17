import 'package:epos_ac/data/models/material_request.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('RequestStatus', () {
    test('fromValue memetakan nilai; tak dikenal -> pending', () {
      expect(RequestStatus.fromValue('pending'), RequestStatus.pending);
      expect(RequestStatus.fromValue('approved'), RequestStatus.approved);
      expect(RequestStatus.fromValue('rejected'), RequestStatus.rejected);
      expect(RequestStatus.fromValue('ngawur'), RequestStatus.pending);
      expect(RequestStatus.fromValue(null), RequestStatus.pending);
    });
  });

  test('MaterialRequest.fromMap membaca baris + items', () {
    final r = MaterialRequest.fromMap('r1', {
      'job_id': 'j1',
      'invoice_id': 'inv1',
      'status': 'approved',
      'total': 300000,
      'note': 'butuh freon',
      'decision_note': 'ok',
      'created_at': '2026-07-17T03:00:00Z',
      'decided_at': '2026-07-17T04:00:00Z',
      'items': [
        {
          'kind': 'sparepart',
          'ref_id': 's1',
          'name': 'Freon R32',
          'unit': 'tabung',
          'qty': 2,
          'unit_price': 150000,
          'line_total': 300000,
        },
      ],
    });

    expect(r.id, 'r1');
    expect(r.status, RequestStatus.approved);
    expect(r.isPending, isFalse);
    expect(r.total, 300000);
    expect(r.invoiceId, 'inv1');
    expect(r.note, 'butuh freon');
    expect(r.decisionNote, 'ok');
    expect(r.items, hasLength(1));
    expect(r.items.first.name, 'Freon R32');
    expect(r.items.first.qty, 2);
    expect(r.items.first.lineTotal, 300000);
  });

  test('MaterialRequest.fromMap tanpa items: pending & list kosong', () {
    final r = MaterialRequest.fromMap('r2', {
      'job_id': 'j2',
      'status': 'pending',
      'total': 0,
    });
    expect(r.isPending, isTrue);
    expect(r.items, isEmpty);
    expect(r.invoiceId, isNull);
    expect(r.createdAt, isNull);
  });
}
