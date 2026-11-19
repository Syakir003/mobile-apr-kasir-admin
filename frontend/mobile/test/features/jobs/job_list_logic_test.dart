import 'package:epos_ac/data/models/job_distance.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/job_list_logic.dart';
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job(String id, {DateTime? at, String member = 'Budi', String addr = '', String work = '', String tech = ''}) =>
    TechnicianJob(
      id: id,
      orderId: 'o$id',
      memberId: 'm',
      unitId: 'u',
      technicianId: 't',
      type: 'cuci',
      status: JobStatus.assigned,
      scheduledDate: at,
      memberName: member,
      memberAddress: addr,
      workAddress: work,
      technicianNames: tech.isEmpty ? const [] : [tech],
    );

JobDistance _ok(String id, double km, [DistancePrecision p = DistancePrecision.titik]) =>
    JobDistance(jobId: id, state: DistanceState.ok, km: km, precision: p);

void main() {
  group('hari', () {
    test('addDaysKey & weekRange (Senin-Minggu)', () {
      expect(addDaysKey('2026-11-30', 1), '2026-12-01');
      expect(addDaysKey('2026-03-01', -1), '2026-02-28');
      // 17 Nov 2026 = Selasa -> pekan 16..22 Nov
      expect(weekRange('2026-11-17'), ('2026-11-16', '2026-11-22'));
      expect(weekRange('2026-11-22'), ('2026-11-16', '2026-11-22')); // Minggu tetap di pekan yang sama
    });

    test('matchesDay: today/tomorrow/week/tanggal; tanpa jadwal hanya lolos "all"', () {
      final j = _job('1', at: DateTime(2026, 11, 18, 9));
      expect(matchesDay(j, 'all', '2026-11-17'), isTrue);
      expect(matchesDay(j, 'today', '2026-11-17'), isFalse);
      expect(matchesDay(j, 'tomorrow', '2026-11-17'), isTrue);
      expect(matchesDay(j, 'week', '2026-11-17'), isTrue);
      expect(matchesDay(j, '2026-11-18', '2026-11-17'), isTrue);
      expect(matchesDay(_job('2'), 'all', '2026-11-17'), isTrue);
      expect(matchesDay(_job('2'), 'today', '2026-11-17'), isFalse);
    });

    test('dayFilterRange', () {
      expect(dayFilterRange('all', '2026-11-17'), ('', ''));
      expect(dayFilterRange('tomorrow', '2026-11-17'), ('2026-11-18', '2026-11-18'));
      expect(dayFilterRange('2026-12-01', '2026-11-17'), ('2026-12-01', '2026-12-01'));
    });
  });

  test('rowSearchText: teknisi hanya dicari bila diminta; lokasi kerja menimpa alamat member', () {
    final j = _job('1', member: 'Siti', addr: 'Jl. Lama', work: 'Jl. Kerja', tech: 'Ani');
    expect(rowSearchText([j], includeTechnician: false), isNot(contains('ani')));
    expect(rowSearchText([j], includeTechnician: true), contains('ani'));
    expect(rowSearchText([j], includeTechnician: false), contains('jl. kerja'));
    expect(rowSearchText([j], includeTechnician: false), isNot(contains('jl. lama')));
  });

  group('jarak', () {
    test('rowDistance: ambil job terdekat; pending menang atas unknown bila tak ada yang ok', () {
      final row = [_job('a'), _job('b')];
      final d = rowDistance(row, {'a': _ok('a', 9.5), 'b': _ok('b', 2.1, DistancePrecision.desa)});
      expect(d.state, DistanceState.ok);
      expect(d.km, 2.1);
      expect(d.precision, DistancePrecision.desa);

      final p = rowDistance(row, {
        'a': const JobDistance(jobId: 'a', state: DistanceState.pending),
        'b': const JobDistance(jobId: 'b', state: DistanceState.unknown, reason: DistanceReason.incomplete),
      });
      expect(p.state, DistanceState.pending);

      final u = rowDistance([_job('b')], {
        'b': const JobDistance(jobId: 'b', state: DistanceState.unknown, reason: DistanceReason.incomplete),
      });
      expect(u.state, DistanceState.unknown);
      expect(u.reason, DistanceReason.incomplete);
      expect(rowDistance([_job('x')], const {}).reason, DistanceReason.noAddress);
    });

    test('nearestOrder: yang diketahui dulu (dekat ke jauh), sisanya urutan asal', () {
      const unk = RowDistance.unknown(DistanceReason.notFound);
      const pen = RowDistance.pending();
      final order = nearestOrder([unk, const RowDistance.ok(5, null), pen, const RowDistance.ok(1.2, null), unk]);
      expect(order, [3, 1, 0, 2, 4]);
    });

    test('kmText memakai koma desimal dan membuang ,0', () {
      expect(kmText(3.4), '3,4 km');
      expect(kmText(12), '12 km');
    });

    test('JobDistancesResult.fromJson membaca bentuk respons server', () {
      final r = JobDistancesResult.fromJson({
        'shop': {'lat': 1, 'lng': 2, 'label': 'Toko'},
        'pending': 1,
        'items': [
          {'jobId': 'a', 'km': 3.4, 'state': 'ok', 'precision': 'wilayah'},
          {'jobId': 'b', 'km': null, 'state': 'unknown', 'reason': 'incomplete'},
          {'jobId': 'c', 'km': null, 'state': 'pending'},
        ],
      });
      expect(r.pending, 1);
      expect(r.items[0].precision, DistancePrecision.wilayah);
      expect(r.items[0].km, 3.4);
      expect(r.items[1].reason, DistanceReason.incomplete);
      expect(r.items[2].state, DistanceState.pending);
    });
  });
}
