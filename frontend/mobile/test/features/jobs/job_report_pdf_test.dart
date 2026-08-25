import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/data/models/material_request.dart';
import 'package:epos_ac/features/jobs/job_report_pdf.dart';

TechnicianJob _job() => TechnicianJob(
      id: 'job-1',
      orderId: 'order-1',
      memberId: 'mbr-1',
      unitId: 'unit-1',
      technicianId: 'tek-1',
      type: 'pemasangan',
      status: JobStatus.selesai,
      startedAt: DateTime(2026, 8, 20, 9, 0),
      completedAt: DateTime(2026, 8, 20, 11, 30),
      memberName: 'Café Séverine',
      memberPhone: '+6281298765400',
      memberAddress: 'Jl. Mawar No. 1',
      unitBrand: 'Panasonic',
      unitModel: 'CS-YN5',
      unitPk: 0.5,
      unitRoom: 'Kamar Utama',
      technicianName: 'Ünit Teknisi',
    );

List<MaterialRequestItem> _materials() => const [
      MaterialRequestItem(
        id: 'mri-1',
        kind: 'sparepart',
        refId: 'sp-1',
        name: 'Freon R32',
        unit: 'tabung',
        qty: 1,
        unitPrice: 150000,
        lineTotal: 150000,
      ),
    ];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('laporan pekerjaan memakai font ber-Unicode, bukan Helvetica bawaan',
      () async {
    final bytes = await buildJobReportPdf(_job(), _materials());
    final raw = latin1.decode(bytes, allowInvalid: true);

    expect(raw.contains('Roboto'), isTrue,
        reason: 'font Roboto tidak tertanam di PDF');
    expect(raw.contains('Helvetica'), isFalse,
        reason: 'masih memakai font tanpa dukungan Unicode');
  });

  test('laporan pekerjaan berhasil dibangun tanpa material tambahan',
      () async {
    final bytes = await buildJobReportPdf(_job(), const []);
    expect(bytes.length, greaterThan(1000));
  });
}
