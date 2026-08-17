import 'package:epos_ac/data/models/undian.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _row({String status = 'berjalan'}) => {
      'title': 'Undian Agustus',
      'description': null,
      'winner_count': 3,
      'discount_type': 'persen',
      'discount_value': 15,
      'max_discount_cap': 200000,
      'min_purchase': null,
      'voucher_valid_days': 30,
      'status': status,
      'drawn_at': null,
      'created_at': '2026-08-17T02:00:00Z',
    };

void main() {
  group('Undian.fromMap', () {
    test('memetakan kolom apa adanya', () {
      final u = Undian.fromMap('u1', _row());
      expect(u.title, 'Undian Agustus');
      expect(u.winnerCount, 3);
      expect(u.discountLabel, '15%');
    });

    test('semua status dikenali', () {
      for (final s in UndianStatus.values) {
        expect(Undian.fromMap('u', _row(status: s.value)).status, s);
      }
    });
  });

  group('UndianParticipant.fromMap', () {
    test('memetakan kolom apa adanya', () {
      final p = UndianParticipant.fromMap('p1', {
        'undian_id': 'u1',
        'member_id': 'm1',
        'source': 'manual',
      });
      expect(p.undianId, 'u1');
      expect(p.memberId, 'm1');
      expect(p.source, 'manual');
    });
  });
}
