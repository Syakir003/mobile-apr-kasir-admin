import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../core/pdf/pdf_theme.dart';
import '../../data/models/material_request.dart';
import '../../data/models/technician_job.dart';

/// Laporan Pekerjaan A4 (pola nota fisik "CV. AYUB PODO RUKUN") — berlaku
/// sebagai kartu garansi. [job] mengisi header & baris pekerjaan utama;
/// [materials] (mis. item pengajuan yang disetujui) jadi baris tambahan.
/// GARANSI dibiarkan titik-titik kosong, sama seperti formulir kertasnya —
/// diisi tangan sesuai kesepakatan di lapangan.
///
/// Servis banyak AC: isi [orderJobs] dengan SEMUA job order (satu laporan untuk seluruh job) —
/// satu baris pekerjaan per unit, [materials] gabungan semua unit, petugas dan waktu dari seluruh
/// unit. Unit yang dibatalkan tidak ikut. [job] tetap job yang dibuka (nomor, pelanggan).
Future<Uint8List> buildJobReportPdf(
  TechnicianJob job,
  List<MaterialRequestItem> materials, {
  List<TechnicianJob> orderJobs = const [],
}) async {
  final doc = pw.Document(theme: await pdfTheme());
  final logo = await pdfLogo();
  final report = _ReportData.of(job, materials, orderJobs);
  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      build: (context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          _header(job, report, logo),
          pw.SizedBox(height: 12),
          _workTable(report.rows),
          pw.SizedBox(height: 10),
          _petugasTable(report),
          pw.SizedBox(height: 16),
          _notes(),
        ],
      ),
    ),
  );
  return doc.save();
}

/// Isi laporan yang sudah dihitung: satu job, atau gabungan seluruh unit satu order.
class _ReportData {
  _ReportData({
    required this.number,
    required this.refDate,
    required this.rows,
    required this.petugas,
    required this.start,
    required this.end,
  });

  final String number;
  final DateTime? refDate;
  final List<({String qty, String text})> rows;
  final String petugas;
  final DateTime? start;
  final DateTime? end;

  factory _ReportData.of(
      TechnicianJob job, List<MaterialRequestItem> materials, List<TechnicianJob> orderJobs) {
    final matRows = [
      for (final m in materials) (qty: '${_trimZero(m.qty)} ${m.unit}'.trim(), text: m.name),
    ];
    String keterangan(TechnicianJob j) {
      final unitDesc = [j.unitTitle, if (j.unitRoom.isNotEmpty) j.unitRoom]
          .where((s) => s.isNotEmpty)
          .join(' — ');
      final k = [j.typeLabel, unitDesc].where((s) => s.isNotEmpty).join(' - ');
      return k.isEmpty ? '-' : k;
    }

    String numberOf(String id) =>
        id.length >= 8 ? id.substring(0, 8).toUpperCase() : id.toUpperCase();

    // Teknisi sebelumnya (alih tugas) lalu teknisi sekarang, tanpa duplikat.
    String petugasOf(List<TechnicianJob> jobs) => {
          for (final j in jobs) ...[
            for (final h in j.handovers) h.fromName,
            j.technicianName,
          ],
        }.where((n) => n.isNotEmpty && n != '-').join(', ');

    final jobs = orderJobs.where((j) => j.status != JobStatus.dibatalkan).toList();
    if (jobs.length < 2) {
      return _ReportData(
        number: numberOf(job.id),
        refDate: job.completedAt ?? job.startedAt ?? job.createdAt,
        rows: [(qty: '1 unit', text: keterangan(job)), ...matRows],
        petugas: petugasOf([job]),
        start: job.startedAt,
        end: job.completedAt,
      );
    }
    final starts = jobs.map((j) => j.startedAt).whereType<DateTime>().toList()..sort();
    final ends = jobs.map((j) => j.completedAt).whereType<DateTime>().toList()..sort();
    // Selesai = saat unit TERAKHIR disetujui, dan hanya bila semua unit sudah selesai.
    final allDone =
        jobs.every((j) => j.status == JobStatus.selesai) && ends.length == jobs.length;
    final start = starts.isEmpty ? null : starts.first;
    final end = allDone ? ends.last : null;
    return _ReportData(
      number: numberOf(job.orderId.isEmpty ? job.id : job.orderId),
      refDate: end ?? start ?? job.createdAt,
      rows: [
        for (final j in jobs) (qty: '1 unit', text: keterangan(j)),
        ...matRows,
      ],
      petugas: petugasOf(jobs),
      start: start,
      end: end,
    );
  }
}

pw.Widget _boxed(pw.Widget child) => pw.Container(
      padding: const pw.EdgeInsets.all(8),
      decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.8)),
      child: child,
    );

pw.Widget _header(TechnicianJob job, _ReportData report, pw.MemoryImage logo) {
  final refDate = report.refDate;
  return pw.Row(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      pw.Expanded(
        flex: 5,
        child: _boxed(
          pw.Row(
            children: [
              pw.Image(logo, height: 32),
              pw.SizedBox(width: 6),
              pw.Expanded(
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text('CV. AYUB PODO RUKUN',
                        style: const pw.TextStyle(
                            fontSize: 11, fontWeight: pw.FontWeight.bold)),
                    pw.Text('Penjualan • Service • Spare Part • Rental AC',
                        style: const pw.TextStyle(
                            fontSize: 7, fontWeight: pw.FontWeight.bold)),
                    pw.Text('JL. GUNUNG ANYAR RT. 01 RW. 06',
                        style: const pw.TextStyle(fontSize: 7)),
                    pw.Text('KEL. GUNUNG GEDANGAN - MOJOKERTO',
                        style: const pw.TextStyle(fontSize: 7)),
                    pw.Text('TLP. : 0857 332 7112 - 0822 3388 9990',
                        style: const pw.TextStyle(fontSize: 7)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      pw.SizedBox(width: 10),
      pw.Expanded(
        flex: 3,
        child: pw.Center(
          child: pw.Text('LAPORAN\nPEKERJAAN',
              textAlign: pw.TextAlign.center,
              style: const pw.TextStyle(
                  fontSize: 16, fontWeight: pw.FontWeight.bold)),
        ),
      ),
      pw.SizedBox(width: 10),
      pw.Expanded(
        flex: 6,
        child: pw.Table(
          border: pw.TableBorder.all(width: 0.8),
          columnWidths: const {
            0: pw.FlexColumnWidth(2),
            1: pw.FlexColumnWidth(5),
          },
          children: [
            _infoRow('NO.', report.number),
            _infoRow('TGL.', refDate != null ? _formatDate(refDate) : ''),
            _infoRow('NAMA', job.memberName),
            _infoRow('ALAMAT', job.memberAddress),
            _infoRow('TLP.', job.memberPhone),
          ],
        ),
      ),
    ],
  );
}

pw.TableRow _infoRow(String label, String value) => pw.TableRow(
      children: [
        pw.Padding(
          padding: const pw.EdgeInsets.all(4),
          child: pw.Text(label,
              style: const pw.TextStyle(
                  fontSize: 8, fontWeight: pw.FontWeight.bold)),
        ),
        pw.Padding(
          padding: const pw.EdgeInsets.all(4),
          child: pw.Text(value, style: const pw.TextStyle(fontSize: 8)),
        ),
      ],
    );

pw.Widget _workTable(List<({String qty, String text})> items) {
  return pw.Table(
    border: pw.TableBorder.all(width: 0.8),
    columnWidths: const {
      0: pw.FlexColumnWidth(1),
      1: pw.FlexColumnWidth(2),
      2: pw.FlexColumnWidth(8),
    },
    children: [
      pw.TableRow(
        decoration: const pw.BoxDecoration(color: PdfColors.grey300),
        children: [
          _cell('NO.', bold: true, align: pw.TextAlign.center),
          _cell('JUMLAH\nBARANG', bold: true, align: pw.TextAlign.center),
          _cell('KETERANGAN', bold: true, align: pw.TextAlign.center),
        ],
      ),
      for (var i = 0; i < items.length; i++)
        pw.TableRow(children: [
          _cell('${i + 1}', align: pw.TextAlign.center),
          _cell(items[i].qty, align: pw.TextAlign.center),
          _cell(items[i].text),
        ]),
      // Baris kosong seperti formulir kertas: 6 dikurangi jumlah baris tambahan (selain baris pekerjaan pertama).
      for (var i = 0; i < (6 - (items.length - 1)).clamp(0, 6); i++)
        pw.TableRow(children: [_cell(''), _cell(''), _cell('')]),
    ],
  );
}

pw.Widget _petugasTable(_ReportData report) {
  return pw.Table(
    border: pw.TableBorder.all(width: 0.8),
    columnWidths: const {
      0: pw.FlexColumnWidth(3),
      1: pw.FlexColumnWidth(2),
      2: pw.FlexColumnWidth(2),
      3: pw.FlexColumnWidth(3),
    },
    children: [
      pw.TableRow(
        decoration: const pw.BoxDecoration(color: PdfColors.grey300),
        children: [
          _cell('NAMA PETUGAS', bold: true, align: pw.TextAlign.center),
          _cell('MULAI', bold: true, align: pw.TextAlign.center),
          _cell('SELESAI', bold: true, align: pw.TextAlign.center),
          _cell('GARANSI', bold: true, align: pw.TextAlign.center),
        ],
      ),
      pw.TableRow(children: [
        _cell(report.petugas.isEmpty ? '-' : report.petugas, align: pw.TextAlign.center),
        _cell(report.start != null ? _formatTime(report.start!) : '-',
            align: pw.TextAlign.center),
        _cell(report.end != null ? _formatTime(report.end!) : '-',
            align: pw.TextAlign.center),
        _cell('.......... Bln', align: pw.TextAlign.center),
      ]),
    ],
  );
}

pw.Widget _notes() {
  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      pw.Text(
          '* Garansi berlaku apabila kerusakan sama & dalam batas waktu yang sudah ditentukan',
          style: const pw.TextStyle(fontSize: 7)),
      pw.Text(
          '* Laporan Pekerjaan ini berlaku sebagai kartu garansi. Tunjukkan ini apabila perbaikan dalam masa garansi',
          style: const pw.TextStyle(fontSize: 7)),
      pw.Text(
          '* Jangan memberi tip kepada teknisi / petugas kami. Mintalah kwitansi / tanda terima yang resmi dalam pembayaran',
          style: const pw.TextStyle(fontSize: 7)),
      pw.SizedBox(height: 24),
      pw.Row(
        children: [
          pw.Expanded(
            child: pw.Column(children: [
              pw.Text('Petugas,', style: const pw.TextStyle(fontSize: 9)),
              pw.SizedBox(height: 32),
              pw.Text('...................................',
                  style: const pw.TextStyle(fontSize: 9)),
            ]),
          ),
          pw.Expanded(
            child: pw.Column(children: [
              pw.Text('Pelanggan,', style: const pw.TextStyle(fontSize: 9)),
              pw.SizedBox(height: 32),
              pw.Text('...................................',
                  style: const pw.TextStyle(fontSize: 9)),
            ]),
          ),
        ],
      ),
    ],
  );
}

pw.Widget _cell(String text, {bool bold = false, pw.TextAlign? align}) {
  return pw.Padding(
    padding: const pw.EdgeInsets.all(4),
    child: pw.Text(
      text,
      textAlign: align,
      style: pw.TextStyle(
          fontSize: 8, fontWeight: bold ? pw.FontWeight.bold : null),
    ),
  );
}

String _formatDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year}';
}

String _formatTime(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${_formatDate(d)} ${two(d.hour)}:${two(d.minute)}';
}

String _trimZero(num v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();
