import 'package:epos_ac/data/models/wa_message.dart';
import 'package:epos_ac/features/reminders/reminder_providers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('baris GET /whatsapp-logs dibaca jadi WaMessage', () {
    final m = WaMessage.fromMap('w1', waLogRowFromNest({
      'id': 'w1',
      'memberId': 'm1',
      'member': {'id': 'm1', 'name': 'Budi'},
      'kind': 'invoice',
      'unitIds': ['u1', 'u2'],
      'phone': '62812345678',
      'message': 'Halo Budi',
      'dueDate': '2026-11-10T00:00:00.000Z',
      'status': 'gagal',
      'error': 'Nomor tidak valid',
      'sentAt': null,
      'createdAt': '2026-11-05T03:00:00.000Z',
    }));
    expect((m.memberName, m.kind, m.body, m.status, m.unitCount, m.error),
        ('Budi', WaKind.invoice, 'Halo Budi', WaStatus.gagal, 2, 'Nomor tidak valid'));
  });

  test('log tanpa member (mis. nota ke nomor bebas) tidak error', () {
    final m = WaMessage.fromMap('w2', waLogRowFromNest({'id': 'w2', 'member': null, 'kind': 'reminder_h3', 'status': 'terkirim'}));
    expect((m.memberId, m.memberName, m.status), ('', '', WaStatus.terkirim));
  });
}
