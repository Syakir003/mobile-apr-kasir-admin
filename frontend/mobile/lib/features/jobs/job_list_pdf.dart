import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../core/pdf/pdf_kop.dart';
import '../../core/pdf/pdf_theme.dart';
import '../../core/utils/tanggal.dart';
import '../../data/models/technician_job.dart';
import 'job_list_logic.dart';
import 'job_providers.dart' show groupJobsByOrder;

/// Cetak Daftar Pekerjaan Servis (cerminan `print-list` di web): pelanggan, unit AC, lokasi kerja, jenis, dan catatan,
/// dikelompokkan per hari jadwal. Sengaja TANPA nama teknisi, status, dan harga: lembar ini daftar apa yang dikerjakan.
enum PrintStatus {
  aktif('Aktif'),
  selesai('Selesai'),
  semua('Semua status');

  const PrintStatus(this.label);
  final String label;

  static PrintStatus parse(String? v) => switch (v) {
        'selesai' => selesai,
        'semua' => semua,
        _ => aktif,
      };
}

/// Tanggal jadwal satu baris (servis banyak AC: satu order = satu jadwal). Tanpa jadwal = ''.
String rowDate(List<TechnicianJob> row) {
  final s = row.where((j) => j.scheduledDate != null).firstOrNull?.scheduledDate;
  return s == null ? '' : dayKey(s);
}

/// Baris yang masuk cetakan: pekerjaan batal tidak ikut di status apa pun; [from]/[to] ('YYYY-MM-DD', '' = tanpa batas)
/// menyaring jadwal (tanpa jadwal tidak ikut bila tanggal dibatasi); urut tanggal lalu nama pelanggan.
List<List<TechnicianJob>> selectPrintRows(
  List<TechnicianJob> jobs, {
  String from = '',
  String to = '',
  PrintStatus status = PrintStatus.aktif,
  String query = '',
}) {
  final filtered = jobs.where((j) {
    if (j.status == JobStatus.dibatalkan) return false;
    if (status == PrintStatus.aktif && !j.status.isActive) return false;
    if (status == PrintStatus.selesai && j.status.isActive) return false;
    if (from.isNotEmpty || to.isNotEmpty) {
      final s = j.scheduledDate;
      if (s == null) return false;
      final k = dayKey(s);
      if (from.isNotEmpty && k.compareTo(from) < 0) return false;
      if (to.isNotEmpty && k.compareTo(to) > 0) return false;
    }
    return true;
  }).toList();
  final term = query.trim().toLowerCase();
  final rows = groupJobsByOrder(filtered)
      .where((r) => term.isEmpty || rowSearchText(r, includeTechnician: false).contains(term))
      .toList();
  rows.sort((a, b) {
    final da = rowDate(a), db = rowDate(b);
    if (da != db) return da.isEmpty ? 1 : (db.isEmpty ? -1 : da.compareTo(db));
    return a.first.memberName.toLowerCase().compareTo(b.first.memberName.toLowerCase());
  });
  return rows;
}

/// Judul periode: "17 Nov 2026", "16 Nov 2026 - 22 Nov 2026", "mulai ...", "sampai ...", atau "Semua tanggal".
String periodeText(String from, String to) {
  String f(String k) => formatTanggalSingkat(DateTime.parse(k));
  if (from.isNotEmpty && to.isNotEmpty) return from == to ? f(from) : '${f(from)} - ${f(to)}';
  if (from.isNotEmpty) return 'mulai ${f(from)}';
  if (to.isNotEmpty) return 'sampai ${f(to)}';
  return 'Semua tanggal';
}

const _noType = '(Unit AC belum ada Tipe)';

/// Keterangan tipe satu unit: merk + model, atau Indoor/Outdoor, atau tulisan belum ada tipe.
String unitTypeText(TechnicianJob j) {
  if (j.unitId == null && j.unitTitle.isEmpty) return 'Order ${j.typeLabel}';
  return j.unitTitle.isNotEmpty ? j.unitTitle : (j.unitParts.isNotEmpty ? j.unitParts : _noType);
}

Future<Uint8List> buildJobListPdf(
  List<List<TechnicianJob>> rows, {
  String from = '',
  String to = '',
  PrintStatus status = PrintStatus.aktif,
  String query = '',
  DateTime? printedAt,
}) async {
  final doc = pw.Document(theme: await pdfTheme());
  final logo = await pdfLogo();
  final now = printedAt ?? DateTime.now();
  final totalUnits = rows.fold<int>(0, (n, r) => n + r.length);

  // Kelompok per hari, urutan mengikuti [rows] (sudah terurut tanggal).
  final byDay = <String, List<List<TechnicianJob>>>{};
  for (final r in rows) {
    byDay.putIfAbsent(rowDate(r), () => []).add(r);
  }

  const small = pw.TextStyle(fontSize: 8.5);
  const bold = pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold);

  pw.Widget cell(String t, {pw.TextStyle? style, pw.Alignment align = pw.Alignment.topLeft}) =>
      pw.Container(padding: const pw.EdgeInsets.all(4), alignment: align, child: pw.Text(t, style: style ?? small));

  pw.Widget dayTable(List<List<TechnicianJob>> dayRows, int startNo) {
    final head = pw.TableRow(
      decoration: const pw.BoxDecoration(color: PdfColors.grey300),
      children: [
        for (final h in ['No', 'Pelanggan', 'Unit AC', 'Lokasi Kerja', 'Jenis', 'Catatan'])
          cell(h, style: bold, align: pw.Alignment.center),
      ],
    );
    final body = <pw.TableRow>[];
    for (final (i, row) in dayRows.indexed) {
      final first = row.first;
      final units = row.map(unitTypeText).toList();
      final locations = {for (final j in row) jobLocation(j)}.where((l) => l.isNotEmpty).toList();
      final types = {for (final j in row) j.typeLabel}.toList();
      final note = row.map((j) => (j.notes ?? '').trim()).where((n) => n.isNotEmpty).firstOrNull ?? '';
      body.add(pw.TableRow(children: [
        cell('${startNo + i}', align: pw.Alignment.topCenter),
        cell(first.memberName.isEmpty ? 'Order servis' : first.memberName, style: bold),
        cell(units.length > 1
            ? '${units.length} unit AC\n${[for (final (k, u) in units.indexed) '${k + 1}. ${u == _noType ? 'tanpa tipe' : u}'].join('\n')}'
            : (units.first.isEmpty ? '-' : units.first)),
        cell(locations.isEmpty
            ? '-'
            : locations.length > 1
                ? [for (final (k, l) in locations.indexed) '${k + 1}. $l'].join('\n')
                : locations.first),
        cell(types.join(', ')),
        cell(note),
      ]));
    }
    return pw.Table(
      border: pw.TableBorder.all(width: 0.6),
      columnWidths: const {
        0: pw.FixedColumnWidth(26),
        1: pw.FlexColumnWidth(2),
        2: pw.FlexColumnWidth(3),
        3: pw.FlexColumnWidth(4),
        4: pw.FlexColumnWidth(1.7),
        5: pw.FlexColumnWidth(2.6),
      },
      children: [head, ...body],
    );
  }

  final widgets = <pw.Widget>[
    pdfKop(logo),
    pw.Center(child: pw.Text('DAFTAR PEKERJAAN SERVIS', style: const pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold))),
    pw.SizedBox(height: 4),
    pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
      pw.Text(
        'Jadwal: ${periodeText(from, to)} • Status: ${status.label}${query.trim().isEmpty ? '' : ' • Kata kunci: ${query.trim()}'}',
        style: const pw.TextStyle(fontSize: 8.5),
      ),
      pw.Text('Dicetak: ${formatTanggalPanjang(now)} ${now.hour.toString().padLeft(2, '0')}.${now.minute.toString().padLeft(2, '0')}',
          style: const pw.TextStyle(fontSize: 8.5)),
    ]),
    pw.SizedBox(height: 6),
  ];

  var no = 1;
  for (final e in byDay.entries) {
    widgets.add(pw.Container(
      width: double.infinity,
      color: PdfColors.grey200,
      padding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 3),
      child: pw.Text(
        e.key.isEmpty
            ? 'Tanpa jadwal (${e.value.length} pekerjaan)'
            : '${formatTanggalPanjang(DateTime.parse(e.key))} (${e.value.length} pekerjaan)',
        style: bold,
      ),
    ));
    widgets.add(dayTable(e.value, no));
    widgets.add(pw.SizedBox(height: 8));
    no += e.value.length;
  }
  widgets.add(pw.Text('Total: ${rows.length} pekerjaan ($totalUnits unit AC)', style: bold));

  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.a4.landscape,
    margin: const pw.EdgeInsets.all(28),
    build: (_) => widgets,
  ));
  return doc.save();
}
