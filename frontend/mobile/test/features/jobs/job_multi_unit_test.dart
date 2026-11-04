import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/data/repositories/job_repository.dart';
import 'package:epos_ac/features/jobs/job_detail_screen.dart' show mergeHandovers, noteRepeatsComplaint;
import 'package:epos_ac/features/jobs/job_providers.dart' show callUpdateJobStatus, groupJobsByOrder;
import 'package:epos_ac/data/models/job_finding.dart';
import 'package:epos_ac/features/jobs/job_report_pdf.dart';
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job(String id,
        {String orderId = 'o1',
        String type = 'cuci',
        String status = 'assigned',
        String? startedAt,
        Map<String, dynamic> extra = const {}}) =>
    TechnicianJob.fromMap(id, technicianJobRowFromNest({
      'orderId': orderId,
      'memberId': 'm1',
      'type': type,
      'status': status,
      'startedAt': startedAt,
      'member': {'name': 'Budi'},
      ...extra,
    }));

Map<String, dynamic> _handover(String from, String to, String at, {String? reason}) => {
      'id': '$from$to$at',
      'createdAt': at,
      'statusAtHandover': 'sedang_dikerjakan',
      'reason': reason,
      'fromTechnician': {'displayName': from},
      'toTechnician': {'displayName': to},
      'handedBy': {'displayName': 'Admin'},
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('groupJobsByOrder', () {
    test('job satu order digabung jadi satu baris, urutan kemunculan pertama', () {
      final rows = groupJobsByOrder([
        _job('a', orderId: 'o1'),
        _job('b', orderId: 'o2'),
        _job('c', orderId: 'o1'),
      ]);
      expect(rows.map((r) => r.map((j) => j.id).toList()), [
        ['a', 'c'],
        ['b'],
      ]);
    });

    test('pemasangan (POS) tetap per job', () {
      final rows = groupJobsByOrder([
        _job('a', type: 'pemasangan'),
        _job('b', type: 'pemasangan'),
      ]);
      expect(rows.length, 2);
    });
  });

  group('parsing GET /technician-jobs/:id', () {
    test('siblings, note order, dan handovers terbaca', () {
      final j = _job('a', extra: {
        'siblings': [
          {'id': 'b'},
          {'id': 'c'}
        ],
        'order': {'invoiceId': null, 'note': 'Cuci semua AC lantai 2'},
        'handovers': [_handover('Andi', 'Budi', '2026-11-01T03:00:00.000Z', reason: 'cuti')],
      });
      expect(j.siblingIds, ['b', 'c']);
      expect(j.orderNote, 'Cuci semua AC lantai 2');
      expect(j.handovers.single.fromName, 'Andi');
      expect(j.handovers.single.statusText, 'dialihkan saat sedang dikerjakan');
    });

    test('servis satu unit: tanpa siblings', () {
      expect(_job('a', extra: {'siblings': []}).siblingIds, isEmpty);
    });

    test('scanned: dialihkan saat dikerjakan (assigned + startedAt) = wajib scan ulang', () {
      expect(_job('a', status: 'sedang_dikerjakan', startedAt: '2026-11-01T03:00:00Z').scanned, isTrue);
      expect(_job('a', status: 'assigned', startedAt: '2026-11-01T03:00:00Z').scanned, isFalse);
      expect(_job('a', status: 'assigned').scanned, isFalse);
    });

    test('temuan: pencatat dan pengunggah foto terbaca', () {
      final f = JobFinding.fromNest({
        'id': 'f1',
        'title': 'Bocor',
        'createdBy': {'displayName': 'Andi'},
        'photos': [
          {'id': 'p', 'kind': 'sebelum', 'path': '/x.jpg', 'uploadedBy': {'displayName': 'Andi'}},
        ],
      });
      expect(f.createdByName, 'Andi');
      expect(f.photos.single.uploadedByName, 'Andi');
    });
  });

  test('mergeHandovers: alih tugas serentak beberapa unit jadi satu entri', () {
    final h = JobHandover.fromNest(_handover('Andi', 'Budi', '2026-11-01T03:00:00.000Z'));
    final dup = JobHandover.fromNest({..._handover('Andi', 'Budi', '2026-11-01T03:00:00.500Z'), 'id': 'x2'});
    expect(mergeHandovers([[h], [dup]]).length, 1);
  });

  test('noteRepeatsComplaint: note sama dengan keluhan awal disembunyikan', () {
    const f = JobFinding(id: '1', title: ' AC Bocor ', origin: 'komplain_awal');
    expect(noteRepeatsComplaint('ac bocor', [f]), isTrue);
    expect(noteRepeatsComplaint('cuci total', [f]), isFalse);
  });

  test('submit_review allInOrder mengirim body allInOrder tanpa catatan', () async {
    final calls = <String>[];
    await callUpdateJobStatus(
      {'jobId': 'a', 'action': 'submit_review', 'allInOrder': true, 'notes': 'x'},
      patch: (path, {body}) async => calls.add('$path $body'),
    );
    expect(calls, ['/technician-jobs/a/submit-for-review {allInOrder: true}']);
  });

  test('unit QR dulu (menunggu_data) dan ringkasan temuan riwayat unit terbaca', () {
    final j = _job('a', extra: {
      'unit': {'brand': 'X', 'status': 'menunggu_data'},
      'findings': [
        {'title': 'Bocor', 'createdBy': {'displayName': 'Andi'}},
      ],
    });
    expect(j.unitAwaitingData, isTrue);
    expect(j.findingHeads.single, (title: 'Bocor', by: 'Andi'));
    expect(_job('b').unitAwaitingData, isFalse);
  });

  test('Laporan Pekerjaan banyak unit: PDF terbentuk dari seluruh unit', () async {
    final jobs = [_job('a'), _job('b'), _job('c', status: 'dibatalkan')];
    final bytes = await buildJobReportPdf(jobs.first, const [], orderJobs: jobs);
    expect(bytes.length, greaterThan(1000));
  });
}
