import 'package:epos_ac/data/models/wa_message.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _row({
  String kind = 'reminder_h3',
  String status = 'pending',
  Object? unitIds = const ['u1', 'u2'],
  Object? dueDate = '2026-08-20',
  Object? createdAt = '2026-08-15T02:00:00Z',
  String body = 'Halo',
}) =>
    {
      'member_id': 'm1',
      'phone': '62812345678',
      'kind': kind,
      'status': status,
      'unit_ids': unitIds,
      'due_date': dueDate,
      'created_at': createdAt,
      'body': body,
    };

void main() {
  group('WaMessage.fromMap', () {
    test('memetakan kolom antrean apa adanya', () {
      final msg = WaMessage.fromMap('w1', _row());
      expect(msg.id, 'w1');
      expect(msg.memberId, 'm1');
      expect(msg.phone, '62812345678');
      expect(msg.kind, WaKind.reminderH3);
      expect(msg.status, WaStatus.pending);
      expect(msg.unitCount, 2);
      expect(msg.dueDate, DateTime.parse('2026-08-20'));
      expect(msg.createdAt, DateTime.parse('2026-08-15T02:00:00Z').toLocal());
    });

    test('semua jenis pesan dikenali', () {
      expect(WaMessage.fromMap('w', _row(kind: 'selesai_servis')).kind,
          WaKind.selesaiServis);
      expect(WaMessage.fromMap('w', _row(kind: 'reminder_h3')).kind,
          WaKind.reminderH3);
      expect(WaMessage.fromMap('w', _row(kind: 'reminder_h7')).kind,
          WaKind.reminderH7);
    });

    test('semua status antrean dikenali', () {
      for (final s in WaStatus.values) {
        expect(WaMessage.fromMap('w', _row(status: s.value)).status, s);
      }
    });

    test('nilai tak dikenal & kolom kosong tidak melempar', () {
      final msg = WaMessage.fromMap(
        'w',
        _row(kind: 'entah', status: 'entah', unitIds: null, dueDate: null,
            createdAt: null),
      );
      expect(msg.kind, WaKind.selesaiServis);
      expect(msg.status, WaStatus.pending);
      expect(msg.unitCount, 0);
      expect(msg.dueDate, isNull);
      expect(msg.createdAt, isNull);
    });
  });

  group('waUri', () {
    test('menyusun tautan wa.me dengan nomor yang sudah ternormalisasi', () {
      final msg = WaMessage.fromMap('w', _row());
      expect(msg.waUri.scheme, 'https');
      expect(msg.waUri.host, 'wa.me');
      expect(msg.waUri.path, '/62812345678');
    });

    test('pesan berbaris banyak, ber-& dan beraksen tetap utuh', () {
      // Redaksi asli `build_wa_body()`: daftar unit dipisah baris baru dan
      // ditutup em-dash. Tanpa encoding, pesan terpotong di karakter pertama
      // yang punya makna khusus di URL.
      const body = 'Halo Renée & André, AC berikut:\n'
          '- Daikin FTV-25 (Ruang Tamu)\n\n— Ayub Podo Rukun';
      final msg = WaMessage.fromMap('w', _row(body: body));

      expect(msg.waUri.queryParameters['text'], body);
      final raw = msg.waUri.toString();
      expect(raw, contains('%0A')); // baris baru
      expect(raw, contains('%26')); // &
      expect(raw, contains('%C3%A9')); // é
      expect(raw, isNot(contains('\n')));
    });
  });
}
