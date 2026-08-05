import 'package:epos_ac/features/audit/audit_providers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('auditActionLabel', () {
    test('memetakan aksi yang dikenal ke label Indonesia', () {
      expect(auditActionLabel('pos.checkout'), 'Checkout Transaksi');
      expect(auditActionLabel('stock.adjust'), 'Mutasi Stok');
      expect(auditActionLabel('user.update'), 'Ubah Akun');
      // update_technician_job_status menulis 'job.' || action.
      expect(auditActionLabel('job.start'), 'Mulai Pekerjaan');
      expect(auditActionLabel('job.complete'), 'Selesaikan Pekerjaan');
      // decide_material_request menulis 'request.' || decision.
      expect(auditActionLabel('request.revise'), 'Revisi Pengajuan');
    });

    test('aksi tak dikenal ditampilkan apa adanya', () {
      expect(auditActionLabel('sesuatu.baru'), 'sesuatu.baru');
      expect(auditActionLabel(''), 'Aktivitas');
    });
  });

  group('AuditEntry.fromMap', () {
    test('memakai nama pelaku dari embed users', () {
      final e = AuditEntry.fromMap({
        'id': '1',
        'action': 'stock.adjust',
        'target': 'p1',
        'detail': {'qtyChange': 5, 'reason': 'pembelian'},
        'at': '2026-07-19T03:04:05Z',
        'actor': {'display_name': 'Adm', 'email': 'a@x.id'},
      });
      expect(e.actorName, 'Adm');
      expect(e.label, 'Mutasi Stok');
      expect(e.detail['reason'], 'pembelian');
      expect(e.at, isNotNull);
    });

    test('jatuh ke email bila nama tampilan kosong', () {
      final e = AuditEntry.fromMap({
        'id': '2',
        'action': 'pos.payment',
        'actor': {'display_name': '', 'email': 'kasir@x.id'},
      });
      expect(e.actorName, 'kasir@x.id');
    });

    test('baris tanpa aktor & tanpa detail tetap aman dibaca', () {
      final e = AuditEntry.fromMap({'id': '3', 'action': 'pos.checkout'});
      expect(e.actorName, isEmpty);
      expect(e.detail, isEmpty);
      expect(e.target, isEmpty);
      expect(e.at, isNull);
    });
  });
}
