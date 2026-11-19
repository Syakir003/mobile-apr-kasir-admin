import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../core/pdf/pdf_kop.dart';
import '../../core/pdf/pdf_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/utils/tanggal.dart';
import 'stock_report_logic.dart';

String _tgl(String ymd) => ymd.length == 10 ? formatTanggalSingkat(DateTime.parse(ymd)) : ymd;

String _num(num n) => n == n.roundToDouble() ? '${n.round()}' : '$n';

/// Laporan Stok per merk (cerminan `laporan/stok/print` di web): satu merk satu lembar A4 landscape berkop, supaya
/// gampang dicocokkan per rak. Role gudang (tanpa angka uang) mendapat kolom Fisik/Selisih kosong dan kotak tanda
/// tangan; admin mendapat Modal/Omzet/Untung dan ringkasan di lembar terakhir.
Future<Uint8List> buildStockReportPdf(
  List<StockGroup> groups, {
  required String from,
  required String to,
  required bool showMoney,
  int hidden = 0,
  ({num modal, num omzet, num untung})? summary,
  DateTime? printedAt,
}) async {
  final doc = pw.Document(theme: await pdfTheme());
  final logo = await pdfLogo();
  final now = printedAt ?? DateTime.now();
  final stamp = '${formatTanggalPanjang(now)} ${now.hour.toString().padLeft(2, '0')}.${now.minute.toString().padLeft(2, '0')}';

  final fs = showMoney ? 8.0 : 9.5;
  final base = pw.TextStyle(fontSize: fs);
  final bold = pw.TextStyle(fontSize: fs, fontWeight: pw.FontWeight.bold);
  final tiny = pw.TextStyle(fontSize: fs - 1.5);

  pw.Widget cell(String t, {pw.TextStyle? style, pw.Alignment align = pw.Alignment.topLeft, double indent = 0}) =>
      pw.Container(
        padding: pw.EdgeInsets.fromLTRB(3 + indent, 3, 3, 3),
        alignment: align,
        child: pw.Text(t, style: style ?? base),
      );
  pw.Widget numCell(String t, {bool strong = false}) =>
      cell(t, style: strong ? bold : base, align: pw.Alignment.topRight);

  pw.Widget groupTable(StockGroup g) {
    final head = pw.TableRow(
      decoration: const pw.BoxDecoration(color: PdfColors.grey300),
      children: [
        for (final h in [
          'No',
          'Nama',
          'Jenis',
          'Stok Awal',
          'Masuk',
          'Masuk dari',
          'Keluar',
          'Tgl Keluar',
          'Keluar ke',
          'Stok Sekarang',
          ...(showMoney ? ['Modal Tersisa', 'Omzet', 'Untung'] : ['Fisik', 'Selisih']),
        ])
          cell(h, style: bold, align: pw.Alignment.center),
      ],
    );
    var no = 0;
    final body = <pw.TableRow>[];
    for (final (i, r) in g.rows.indexed) {
      final outdoor = isPackageOutdoor(g.rows, i);
      if (!outdoor) no++;
      body.add(pw.TableRow(children: [
        cell(outdoor ? '' : '$no', align: pw.Alignment.topCenter),
        pw.Container(
          padding: pw.EdgeInsets.fromLTRB(outdoor ? 12 : 3, 3, 3, 3),
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Text('${outdoor ? '↳ ' : ''}${r.name}', style: base),
            if (r.pairSisa != null) pw.Text('Set lengkap siap jual: ${_num(r.pairSisa!)}', style: tiny),
            if (r.jualSatuanTanpaModal > 0)
              pw.Text('${_num(r.jualSatuanTanpaModal)} unit dijual satuan - modal tidak dialokasikan', style: tiny),
          ]),
        ),
        cell(r.jenisLabel, align: pw.Alignment.topCenter),
        numCell(_num(r.stokAwal)),
        numCell(_num(r.stokMasuk)),
        cell(r.masukDari.isEmpty ? '-' : r.masukDari, style: tiny),
        numCell(_num(r.stokKeluar)),
        cell(r.keluar.isEmpty ? '-' : r.keluar.map((k) => k.tanggal).join('\n'), style: tiny, align: pw.Alignment.topCenter),
        cell(
          r.keluar.isEmpty ? '-' : r.keluar.map((k) => k.qty > 0 ? '${k.pihak} (${_num(k.qty)})' : k.pihak).join('\n'),
          style: tiny,
        ),
        numCell(_num(r.sisaStok), strong: true),
        if (showMoney) ...[
          numCell(formatRupiahNum(r.modalTersisa ?? 0)),
          numCell(formatRupiahNum(r.omzetTerjual ?? 0)),
          numCell(formatRupiahNum(r.untungTerjual ?? 0)),
        ] else ...[
          cell(''),
          cell(''),
        ],
      ]));
    }
    body.add(pw.TableRow(
      decoration: const pw.BoxDecoration(color: PdfColors.grey300),
      children: [
        cell(''),
        cell('Total ${g.label} (${g.rows.length} item)', style: bold),
        for (var k = 0; k < 8; k++) cell(''),
        // Sparepart tidak dijumlah: satuannya campur.
        numCell(g.label == sparepartGroup ? '' : _num(g.totalSisa), strong: true),
        for (var k = 0; k < (showMoney ? 3 : 2); k++) cell(''),
      ],
    ));
    return pw.Table(
      border: pw.TableBorder.all(width: 0.6),
      columnWidths: {
        0: const pw.FixedColumnWidth(24),
        1: const pw.FlexColumnWidth(3.2),
        2: const pw.FixedColumnWidth(48),
        3: const pw.FixedColumnWidth(40),
        4: const pw.FixedColumnWidth(36),
        5: const pw.FlexColumnWidth(2),
        6: const pw.FixedColumnWidth(36),
        7: const pw.FixedColumnWidth(54),
        8: const pw.FlexColumnWidth(2.2),
        9: const pw.FixedColumnWidth(48),
        if (showMoney) ...{
          10: const pw.FixedColumnWidth(62),
          11: const pw.FixedColumnWidth(62),
          12: const pw.FixedColumnWidth(62),
        } else ...{
          10: const pw.FixedColumnWidth(48),
          11: const pw.FixedColumnWidth(48),
        },
      },
      children: [head, ...body],
    );
  }

  if (groups.isEmpty) {
    doc.addPage(pw.Page(
      pageFormat: PdfPageFormat.a4.landscape,
      margin: const pw.EdgeInsets.all(28),
      build: (_) => pw.Column(children: [pdfKop(logo), pw.Text('Tidak ada item.', style: base)]),
    ));
  }

  for (final (gi, g) in groups.indexed) {
    final last = gi == groups.length - 1;
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4.landscape,
      margin: const pw.EdgeInsets.all(28),
      header: (_) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pdfKop(logo),
        pw.Center(
          child: pw.Text('LAPORAN STOK - ${g.label.toUpperCase()}',
              style: const pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
        ),
        pw.SizedBox(height: 3),
        pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
          pw.Text(
            'Periode: ${_tgl(from)} - ${_tgl(to)}${gi == 0 && hidden > 0 ? '   ($hidden barang tanpa stok tidak dicetak)' : ''}',
            style: tiny.copyWith(fontSize: 8.5),
          ),
          pw.Text('Dicetak: $stamp', style: tiny.copyWith(fontSize: 8.5)),
        ]),
        pw.SizedBox(height: 4),
      ]),
      build: (_) => [
        groupTable(g),
        if (!showMoney) ...[
          pw.SizedBox(height: 24),
          pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceEvenly, children: [
            for (final label in ['Dicek oleh', 'Tanggal cek', 'Mengetahui'])
              pw.Column(children: [
                pw.Text(label, style: base),
                pw.SizedBox(height: 30),
                pw.Container(
                  width: 150,
                  padding: const pw.EdgeInsets.only(top: 2),
                  decoration: const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(width: 0.6))),
                  child: pw.Center(
                    child: pw.Text(
                      label == 'Tanggal cek' ? '____ / ____ / ________' : '( ................................ )',
                      style: base,
                    ),
                  ),
                ),
              ]),
          ]),
        ],
        if (last && summary != null) ...[
          pw.SizedBox(height: 10),
          pw.Table(
            border: pw.TableBorder.all(width: 0.6),
            columnWidths: const {0: pw.FixedColumnWidth(140), 1: pw.FixedColumnWidth(110)},
            children: [
              for (final (l, v) in [
                ('Total Modal Tersisa', summary.modal),
                ('Total Omzet Terjual', summary.omzet),
                ('Total Untung Terjual', summary.untung),
              ])
                pw.TableRow(children: [cell(l, style: bold), numCell(formatRupiahNum(v))]),
            ],
          ),
        ],
      ],
    ));
  }
  return doc.save();
}
