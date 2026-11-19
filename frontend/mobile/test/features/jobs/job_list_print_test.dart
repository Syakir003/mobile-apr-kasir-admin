import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/features/jobs/job_list_pdf.dart';
import 'package:flutter_test/flutter_test.dart';

TechnicianJob _job(
  String id, {
  String order = '',
  DateTime? at,
  JobStatus status = JobStatus.assigned,
  String member = 'Budi',
  String brand = 'LG',
  String model = 'X',
  String work = '',
  String tech = 'Rahasia Teknisi',
}) =>
    TechnicianJob(
      id: id,
      orderId: order.isEmpty ? 'o$id' : order,
      memberId: 'm',
      unitId: 'u$id',
      technicianId: 't',
      type: 'cuci',
      status: status,
      scheduledDate: at,
      memberName: member,
      unitBrand: brand,
      unitModel: model,
      workAddress: work,
      technicianName: tech,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('selectPrintRows', () {
    final jobs = [
      _job('1', at: DateTime(2026, 11, 18), member: 'Zed'),
      _job('2', at: DateTime(2026, 11, 17), member: 'Ani'),
      _job('3', member: 'Tanpa Jadwal'),
      _job('4', at: DateTime(2026, 11, 17), status: JobStatus.selesai, member: 'Sudah'),
      _job('5', at: DateTime(2026, 11, 17), status: JobStatus.dibatalkan, member: 'Batal'),
    ];
    List<String> names(List<List<TechnicianJob>> r) => [for (final x in r) x.first.memberName];

    test('aktif: tanpa batal & selesai; urut tanggal, tanpa jadwal paling akhir', () {
      expect(names(selectPrintRows(jobs)), ['Ani', 'Zed', 'Tanpa Jadwal']);
    });

    test('status selesai & semua; batal tidak pernah ikut', () {
      expect(names(selectPrintRows(jobs, status: PrintStatus.selesai)), ['Sudah']);
      expect(names(selectPrintRows(jobs, status: PrintStatus.semua)), ['Ani', 'Sudah', 'Zed', 'Tanpa Jadwal']); // tanggal sama -> urut nama
    });

    test('rentang tanggal membuang yang tanpa jadwal', () {
      expect(names(selectPrintRows(jobs, from: '2026-11-17', to: '2026-11-17')), ['Ani']);
      expect(names(selectPrintRows(jobs, from: '2026-11-18')), ['Zed']);
    });

    test('kata kunci tidak mencari nama teknisi', () {
      expect(names(selectPrintRows(jobs, query: 'zed')), ['Zed']);
      expect(selectPrintRows(jobs, query: 'rahasia'), isEmpty);
    });

    test('servis banyak AC dalam satu order tetap satu baris', () {
      final multi = [_job('a', order: 'O', at: DateTime(2026, 11, 17)), _job('b', order: 'O', at: DateTime(2026, 11, 17))];
      final rows = selectPrintRows(multi);
      expect(rows.length, 1);
      expect(rows.first.length, 2);
    });
  });

  test('periodeText', () {
    expect(periodeText('', ''), 'Semua tanggal');
    expect(periodeText('2026-11-17', '2026-11-17'), '17 Nov 2026');
    expect(periodeText('2026-11-16', '2026-11-22'), '16 Nov 2026 - 22 Nov 2026');
    expect(periodeText('2026-11-16', ''), 'mulai 16 Nov 2026');
  });

  test('PDF daftar pekerjaan berhasil dibangun (kosong maupun berisi), tanpa Helvetica', () async {
    final rows = selectPrintRows([
      _job('1', at: DateTime(2026, 11, 17), work: 'Jl. Mawar, Mojosari, Kabupaten Mojokerto'),
      _job('2', at: DateTime(2026, 11, 17), order: 'O'),
      _job('3', at: DateTime(2026, 11, 17), order: 'O'),
    ]);
    final bytes = await buildJobListPdf(rows, from: '2026-11-17', to: '2026-11-17', printedAt: DateTime(2026, 11, 17, 8, 5));
    expect(bytes.length, greaterThan(1000));
    expect(String.fromCharCodes(bytes).contains('Helvetica'), isFalse);
    expect((await buildJobListPdf(const [])).length, greaterThan(1000));
  });
}
