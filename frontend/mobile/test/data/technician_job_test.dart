import 'package:epos_ac/data/models/service_order.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/data/repositories/job_repository.dart' show technicianJobRowFromNest;
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('JobStatus', () {
    test('fromValue memetakan nilai snake_case; tak dikenal -> menungguPenugasan',
        () {
      expect(JobStatus.fromValue('assigned'), JobStatus.assigned);
      expect(JobStatus.fromValue('sedang_dikerjakan'), JobStatus.sedangDikerjakan);
      expect(JobStatus.fromValue('selesai'), JobStatus.selesai);
      expect(JobStatus.fromValue('dibatalkan'), JobStatus.dibatalkan);
      expect(JobStatus.fromValue('ngawur'), JobStatus.menungguPenugasan);
      expect(JobStatus.fromValue(null), JobStatus.menungguPenugasan);
    });

    test('isActive true untuk belum-selesai, false untuk selesai/dibatalkan', () {
      expect(JobStatus.menungguPenugasan.isActive, isTrue);
      expect(JobStatus.assigned.isActive, isTrue);
      expect(JobStatus.sedangDikerjakan.isActive, isTrue);
      expect(JobStatus.selesai.isActive, isFalse);
      expect(JobStatus.dibatalkan.isActive, isFalse);
    });
  });

  test('jobTypeLabel memetakan jenis dikenal & fallback apa adanya', () {
    expect(jobTypeLabel('pemasangan'), 'Pemasangan');
    expect(jobTypeLabel('cuci'), 'Cuci AC');
    expect(jobTypeLabel('maintenance'), 'Maintenance');
    expect(jobTypeLabel('khusus'), 'khusus');
    expect(jobTypeLabel(''), 'Pekerjaan');
  });

  test('TechnicianJob.fromMap membaca baris + enrichment member/unit/teknisi', () {
    final job = TechnicianJob.fromMap('j1', {
      'order_id': 'o1',
      'member_id': 'm1',
      'unit_id': 'u1',
      'technician_id': 't1',
      'type': 'pemasangan',
      'status': 'assigned',
      'notes': 'cek kapasitor',
      'created_at': '2026-07-17T03:00:00Z',
      'member': {'name': 'Budi', 'phone': '0811', 'address': 'Jl. Mawar'},
      'unit': {
        'brand': 'LG',
        'model': 'Dualcool',
        'pk': 1.5,
        'room_location': 'Kamar Utama',
        'barcode_value': 'ACUNIT-20260717-0001',
      },
      'technician_name': 'Andi',
    });

    expect(job.id, 'j1');
    expect(job.status, JobStatus.assigned);
    expect(job.typeLabel, 'Pemasangan');
    expect(job.memberName, 'Budi');
    expect(job.memberPhone, '0811');
    expect(job.unitTitle, 'LG Dualcool');
    expect(job.unitPk, 1.5);
    expect(job.unitBarcode, 'ACUNIT-20260717-0001');
    expect(job.technicianName, 'Andi');
    expect(job.notes, 'cek kapasitor');
    expect(job.createdAt, isNotNull);
  });

  test('TechnicianJob.fromMap tanpa enrichment: field enrichment kosong', () {
    final job = TechnicianJob.fromMap('j2', {
      'order_id': 'o2',
      'member_id': 'm2',
      'type': 'cuci',
      'status': 'menunggu_penugasan',
    });
    expect(job.unitId, isNull);
    expect(job.technicianId, isNull);
    expect(job.memberName, '');
    expect(job.unitTitle, '');
    expect(job.technicianName, '');
  });

  test('ServiceOrder.fromMap membaca status, member, & jumlah unit', () {
    final order = ServiceOrder.fromMap('o1', {
      'member_id': 'm1',
      'invoice_id': 'inv1',
      'type': 'pemasangan',
      'status': 'terjadwal',
      'member': {'name': 'Budi'},
      'unit_count': 3,
      'done_count': 1,
    });
    expect(order.status, OrderStatus.terjadwal);
    expect(order.typeLabel, 'Pemasangan');
    expect(order.memberName, 'Budi');
    expect(order.unitCount, 3);
    expect(order.doneCount, 1);
  });

  group('banyak teknisi per job', () {
    test('respons Nest membawa semua teknisi (technicianId = pertama)', () {
      final job = TechnicianJob.fromMap(
        'j1',
        technicianJobRowFromNest({
          'technicianId': 't1',
          'technicianIds': ['t1', 't2'],
          'technicians': [
            {'id': 't1', 'displayName': 'Ani'},
            {'id': 't2', 'displayName': 'Budi'},
          ],
          'technician': {'displayName': 'Ani'},
        }),
      );
      expect(job.technicianId, 't1');
      expect(job.technicianIds, ['t1', 't2']);
      expect(job.technicianNames, ['Ani', 'Budi']);
    });

    test('respons lama tanpa technicianIds: dipulihkan dari technicianId & nama tunggal', () {
      final job = TechnicianJob.fromMap(
        'j1',
        technicianJobRowFromNest({
          'technicianId': 't1',
          'technician': {'displayName': 'Ani'},
        }),
      );
      expect(job.technicianIds, ['t1']);
      expect(job.technicianNames, ['Ani']);
    });

    test('job belum ditugaskan: daftar kosong', () {
      final job = TechnicianJob.fromMap('j1', technicianJobRowFromNest({'technicianId': null}));
      expect(job.technicianIds, isEmpty);
      expect(job.technicianNames, isEmpty);
    });

    test('isAssignedTo: true untuk SEMUA teknisi job, false untuk lainnya dan null', () {
      final job = TechnicianJob.fromMap(
        'j1',
        technicianJobRowFromNest({
          'technicianId': 't1',
          'technicianIds': ['t1', 't2'],
        }),
      );
      expect(job.isAssignedTo('t1'), isTrue);
      expect(job.isAssignedTo('t2'), isTrue); // bukan teknisi pertama, tetap boleh mengerjakan
      expect(job.isAssignedTo('t9'), isFalse);
      expect(job.isAssignedTo(null), isFalse);
    });
  });
}
