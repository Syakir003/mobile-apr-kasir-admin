import 'package:epos_ac/data/models/job_finding.dart';
import 'package:epos_ac/data/models/material_request.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/job_detail_screen.dart' show mapsUriFor;
import 'package:epos_ac/features/jobs/job_providers.dart' show submitBlockedReason;
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job({bool priced = true, DateTime? sentAt, String maps = '', String address = ''}) =>
    TechnicianJob(
      id: 'j1',
      orderId: 'o1',
      memberId: 'm1',
      unitId: 'u1',
      technicianId: 't1',
      type: 'cuci',
      status: JobStatus.sedangDikerjakan,
      priced: priced,
      findingsSentAt: sentAt,
      memberMapsUrl: maps,
      memberAddress: address,
    );

JobFinding _finding({bool before = true, bool after = true}) => JobFinding.fromNest({
      'id': 'f',
      'title': 'Filter kotor',
      'photos': [
        if (before) {'id': 'a', 'kind': 'sebelum', 'path': '/x'},
        if (after) {'id': 'b', 'kind': 'sesudah', 'path': '/y'},
      ],
    });

void main() {
  group('submitBlockedReason (gate Ajukan Selesai, sama dengan server)', () {
    test('tanpa temuan -> minta tambah temuan', () {
      expect(submitBlockedReason(_job(), const []), contains('minimal 1 temuan'));
    });

    test('ada temuan tanpa foto sesudah -> hitung temuan yang belum lengkap', () {
      final r = submitBlockedReason(_job(), [_finding(), _finding(after: false)]);
      expect(r, '1 temuan belum lengkap foto sebelum/sesudahnya.');
    });

    test('belum priced & belum dikirim -> minta kirim temuan', () {
      final r = submitBlockedReason(_job(priced: false), [_finding()]);
      expect(r, contains('Kirim temuan'));
    });

    test('belum priced & sudah dikirim -> menunggu harga', () {
      final r = submitBlockedReason(_job(priced: false, sentAt: DateTime(2026, 10, 23)), [_finding()]);
      expect(r, contains('Menunggu kasir/admin'));
    });

    test('semua siap -> null', () {
      expect(submitBlockedReason(_job(), [_finding()]), isNull);
    });
  });

  group('mapsUriFor', () {
    test('mapsUrl http(s) dipakai apa adanya', () {
      expect(mapsUriFor(_job(maps: 'https://maps.app.goo.gl/x'))?.toString(), 'https://maps.app.goo.gl/x');
    });

    test('mapsUrl bukan http (mis. javascript:) ditolak, jatuh ke pencarian alamat', () {
      final u = mapsUriFor(_job(maps: 'javascript:alert(1)', address: 'Jl. Merdeka 1'));
      expect(u?.host, 'www.google.com');
      expect(u?.queryParameters['query'], 'Jl. Merdeka 1');
    });

    test('tanpa mapsUrl dan alamat -> null', () {
      expect(mapsUriFor(_job()), isNull);
    });
  });

  test('JobFinding.origin: default ditambah_teknisi, komplain_awal dibaca', () {
    expect(JobFinding.fromNest({'id': '1', 'title': 'a'}).origin, 'ditambah_teknisi');
    expect(JobFinding.fromNest({'id': '1', 'title': 'a', 'origin': 'komplain_awal'}).origin, 'komplain_awal');
  });

  test('MaterialRequest: qtyUsed per item dan usedNote diparse; null = belum dilaporkan', () {
    final r = MaterialRequest.fromMap('r1', {
      'status': 'approved',
      'used_at': '2026-10-23T08:00:00.000Z',
      'used_note': 'sisa dibawa pulang',
      'items': [
        {'id': 'i1', 'name': 'Freon', 'qty': '2', 'qty_used': '1', 'unit_price': '50000', 'line_total': '100000'},
        {'id': 'i2', 'name': 'Pipa', 'qty': '3', 'unit_price': '1000', 'line_total': '3000'},
      ],
    });
    expect(r.usedNote, 'sisa dibawa pulang');
    expect(r.items[0].qtyUsed, 1);
    expect(r.items[1].qtyUsed, isNull);
  });
}
