import 'package:epos_ac/data/models/job_finding.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/data/repositories/job_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/utils/num_parse.dart';

/// Fungsi murni camelCase(Nest)->snake_case(fromMap) di job_repository.dart —
/// pola sama seperti nest_ac_unit_repository_test.dart.
void main() {
  group('numFromNest', () {
    test('angka langsung diteruskan', () => expect(numFromNest(3), 3));
    test('string desimal (Prisma Decimal.toJSON()) diparse', () {
      expect(numFromNest('1.5'), 1.5);
    });
    test('null/bukan angka -> null', () {
      expect(numFromNest(null), null);
      expect(numFromNest('bukan-angka'), null);
    });
  });

  group('technicianJobRowFromNest', () {
    test('field job dasar dipetakan ke key snake_case', () {
      final row = technicianJobRowFromNest({
        'orderId': 'o1',
        'memberId': 'm1',
        'unitId': 'u1',
        'technicianId': 't1',
        'type': 'pemasangan',
        'status': 'assigned',
        'scheduledDate': '2026-09-20T00:00:00.000Z',
        'notes': 'catatan',
        'startedAt': null,
        'completedAt': null,
        'createdAt': '2026-09-18T00:00:00.000Z',
      });
      expect(row['order_id'], 'o1');
      expect(row['member_id'], 'm1');
      expect(row['unit_id'], 'u1');
      expect(row['technician_id'], 't1');
      expect(row['status'], 'assigned');
      expect(row.containsKey('member'), false);
      expect(row.containsKey('unit'), false);
    });

    test('member/unit/technician bersarang dipetakan kalau ada', () {
      final row = technicianJobRowFromNest({
        'orderId': 'o1',
        'memberId': 'm1',
        'unitId': 'u1',
        'technicianId': 't1',
        'type': 'pemasangan',
        'status': 'assigned',
        'member': {'name': 'Budi', 'phone': '0812', 'address': 'Jl. A'},
        'unit': {
          'brand': 'Daikin',
          'model': 'X1',
          'pk': '1.5',
          'roomLocation': 'Kamar',
          'barcodeValue': 'ACUNIT-1',
        },
        'technician': {'displayName': 'Teknisi A'},
      });
      expect(row['member'], {'name': 'Budi', 'phone': '0812', 'address': 'Jl. A'});
      expect((row['unit'] as Map)['pk'], 1.5);
      expect((row['unit'] as Map)['room_location'], 'Kamar');
      expect((row['unit'] as Map)['barcode_value'], 'ACUNIT-1');
      expect(row['technician_name'], 'Teknisi A');
    });
  });

  group('JobFinding.fromNest', () {
    test('temuan + foto bersarang diparse; hasBefore/hasAfter dihitung per temuan', () {
      final f = JobFinding.fromNest({
        'id': 'f1',
        'title': 'Freon kurang',
        'note': 'bocor di pipa',
        'photos': [
          {'id': 'p1', 'kind': 'sebelum', 'path': '/uploads/job-photos/a.jpg'},
        ],
      });
      expect(f.title, 'Freon kurang');
      expect(f.photos.single.path, '/uploads/job-photos/a.jpg');
      expect(f.hasBefore, true);
      expect(f.hasAfter, false);
    });

    test('tanpa photos -> list kosong (bukan error)', () {
      final f = JobFinding.fromNest({'id': 'f2', 'title': 'Filter kotor'});
      expect(f.photos, isEmpty);
      expect(f.hasBefore, false);
    });
  });

  group('priced (harga jasa ditetapkan)', () {
    TechnicianJob parse(Map<String, dynamic> j) =>
        TechnicianJob.fromMap('j1', technicianJobRowFromNest(j));

    test('order tanpa invoice -> belum priced; dengan invoice -> priced', () {
      expect(parse({'status': 'sedang_dikerjakan', 'order': {'invoiceId': null}}).priced, false);
      expect(parse({'status': 'sedang_dikerjakan', 'order': {'invoiceId': 'inv1'}}).priced, true);
    });

    test('tanpa data order (daftar job) -> dianggap priced, tombol tidak terkunci salah', () {
      expect(parse({'status': 'assigned'}).priced, true);
    });

    test('findingsSentAt diparse', () {
      final j = parse({'status': 'assigned', 'findingsSentAt': '2026-10-23T10:00:00.000Z'});
      expect(j.findingsSentAt, isNotNull);
      expect(parse({'status': 'assigned'}).findingsSentAt, isNull);
    });
  });

  group('status menunggu_review', () {
    test('dipetakan (bukan jatuh ke menunggu_penugasan) dan review_note terbawa', () {
      final row = technicianJobRowFromNest({
        'status': 'menunggu_review',
        'reviewNote': 'foto sesudah kurang jelas',
      });
      final job = TechnicianJob.fromMap('j1', row);
      expect(job.status, JobStatus.menungguReview);
      expect(job.status.isActive, true);
      expect(job.reviewNote, 'foto sesudah kurang jelas');
    });
  });

  group('materialRequestRowFromNest', () {
    test('field dasar + items bersarang dipetakan ke snake_case', () {
      final row = materialRequestRowFromNest({
        'jobId': 'j1',
        'status': 'pending',
        'total': 50000,
        'invoiceId': null,
        'note': 'butuh freon',
        'decisionNote': null,
        'createdAt': '2026-09-18T00:00:00.000Z',
        'decidedAt': null,
        'usedAt': null,
        'items': [
          {
            'id': 'i1',
            'kind': 'sparepart',
            'refId': 'r1',
            'name': 'Freon R32',
            'unit': 'kg',
            'qty': '1.5',
            'unitPrice': 30000,
            'lineTotal': 45000,
          },
        ],
      });
      expect(row['job_id'], 'j1');
      expect(row['note'], 'butuh freon');
      final items = row['items'] as List;
      expect(items, hasLength(1));
      expect(items[0]['ref_id'], 'r1');
      expect(items[0]['qty'], 1.5);
      expect(items[0]['unit_price'], 30000);
      expect(items[0]['line_total'], 45000);
    });

    test('items kosong/null -> list kosong (bukan error)', () {
      final row = materialRequestRowFromNest({
        'jobId': 'j1',
        'status': 'pending',
        'total': 0,
      });
      expect(row['items'], isEmpty);
    });
  });

  group('serviceOrderRowFromNest', () {
    test('field dipetakan + unit_count/done_count dihitung dari serviceOrderUnits', () {
      final row = serviceOrderRowFromNest({
        'memberId': 'm1',
        'invoiceId': 'inv1',
        'type': 'pemasangan',
        'status': 'terjadwal',
        'createdAt': '2026-09-18T00:00:00.000Z',
        'member': {'name': 'Budi'},
        'serviceOrderUnits': [
          {'status': 'selesai'},
          {'status': 'terjadwal'},
          {'status': 'selesai'},
        ],
      });
      expect(row['member_id'], 'm1');
      expect(row['invoice_id'], 'inv1');
      expect((row['member'] as Map)['name'], 'Budi');
      expect(row['unit_count'], 3);
      expect(row['done_count'], 2);
    });

    test('tanpa member/unit -> member absen, count nol', () {
      final row = serviceOrderRowFromNest({
        'memberId': 'm1',
        'type': 'pemasangan',
        'status': 'terjadwal',
      });
      expect(row.containsKey('member'), false);
      expect(row['unit_count'], 0);
      expect(row['done_count'], 0);
    });
  });

  group('jobHistoryExtraFromNest', () {
    test('field camelCase Nest dipetakan langsung ke JobHistoryExtra', () {
      final extra = jobHistoryExtraFromNest({
        'photosBefore': 2,
        'photosAfter': 1,
        'materialItems': 3,
        'materialTotal': 75000,
        'materialPending': 1,
      });
      expect(extra.photosBefore, 2);
      expect(extra.photosAfter, 1);
      expect(extra.materialItems, 3);
      expect(extra.materialTotal, 75000);
      expect(extra.materialPending, 1);
    });

    test('field hilang -> default nol (bukan error)', () {
      final extra = jobHistoryExtraFromNest({});
      expect(extra.photoCount, 0);
      expect(extra.hasMaterial, false);
    });
  });
}
