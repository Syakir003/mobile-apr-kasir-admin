import 'package:epos_ac/data/models/app_notification.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('AppNotification.fromMap membaca baris', () {
    final n = AppNotification.fromMap('n1', {
      'title': 'Job baru ditugaskan',
      'body': 'Anda mendapat tugas pemasangan.',
      'type': 'job_assigned',
      'target': 'job-1',
      'read': false,
      'created_at': '2026-07-17T03:00:00Z',
    });
    expect(n.id, 'n1');
    expect(n.title, 'Job baru ditugaskan');
    expect(n.type, 'job_assigned');
    expect(n.target, 'job-1');
    expect(n.read, isFalse);
    expect(n.isJob, isTrue);
    expect(n.isRequest, isFalse);
    expect(n.createdAt, isNotNull);
  });

  test('isRequest true untuk tipe pengajuan; default field aman', () {
    expect(
      AppNotification.fromMap('n2', {'type': 'request_submitted'}).isRequest,
      isTrue,
    );
    expect(
      AppNotification.fromMap('n3', {'type': 'request_decided'}).isRequest,
      isTrue,
    );
    final empty = AppNotification.fromMap('n4', {});
    expect(empty.read, isFalse);
    expect(empty.title, '');
    expect(empty.type, 'info');
    expect(empty.isJob, isFalse);
  });

  test('route: tujuan ketuk notifikasi sama dengan web', () {
    String? r(String type, [String? target]) =>
        AppNotification.fromMap('n', {'type': type, 'target': target}).route;
    expect(r('job_returned', 'j1'), '/jobs/j1');
    expect(r('job_cancelled'), '/jobs');
    expect(r('request_submitted'), '/pengajuan');
    expect(r('job_handover', 'j1'), '/jobs');
    expect(r('penjualan_baru'), '/keluar-gudang');
    expect(r('stok_menipis'), '/spareparts');
    expect(r('opname_selesai'), '/stok/opname');
    expect(r('unit_correction'), '/koreksi-unit');
    expect(r('unit_data_completed', 'm1'), '/pengingat/jadwal/m1');
    expect(r('service_due', 'm1'), '/orders/new');
    expect(r('info'), isNull);
    expect(
      AppNotification.fromMap('n', {'type': 'service_due', 'target': 'm1'}).routeExtra,
      {'memberId': 'm1', 'dueOnly': true},
    );
  });
}
