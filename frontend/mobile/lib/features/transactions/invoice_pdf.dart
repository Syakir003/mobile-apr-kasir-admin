import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../core/pdf/pdf_theme.dart';
import '../../core/utils/currency.dart';
import '../../core/utils/terbilang.dart';
import '../../data/models/invoice.dart';

/// Invoice A4 formal (pola nota fisik "AYUB AC"), beda dari struk 80mm
/// ([buildReceiptPdf]) yang dipakai untuk cetak langsung di kasir. Dokumen
/// ini self-contained dari snapshot [invoice] — sama seperti struk.
Future<Uint8List> buildInvoicePdf(Invoice invoice) async {
  final doc = pw.Document(theme: await pdfTheme());
  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      build: (context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          _header(invoice),
          pw.SizedBox(height: 12),
          _itemTable(invoice),
          _totalRow(invoice),
          pw.SizedBox(height: 10),
          pw.Text('TERBILANG : ${terbilangRupiah(invoice.grandTotal)}',
              style: const pw.TextStyle(fontSize: 10)),
          pw.SizedBox(height: 12),
          _footer(),
        ],
      ),
    ),
  );
  return doc.save();
}

pw.Widget _boxed(pw.Widget child) => pw.Container(
      padding: const pw.EdgeInsets.all(8),
      decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.8)),
      child: child,
    );

pw.Widget _header(Invoice invoice) {
  return pw.Row(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      pw.Expanded(
        flex: 5,
        child: _boxed(
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.center,
            children: [
              pw.Text('AYUB AC',
                  style: const pw.TextStyle(
                      fontSize: 14, fontWeight: pw.FontWeight.bold)),
              pw.SizedBox(height: 2),
              pw.Text('Penjualan • Service • Spare Part • Rental AC',
                  style: const pw.TextStyle(
                      fontSize: 8, fontWeight: pw.FontWeight.bold)),
              pw.SizedBox(height: 4),
              pw.Text('JL. GUNUNG ANYAR RT. 01 RW. 06',
                  style: const pw.TextStyle(fontSize: 7)),
              pw.Text('KEL. GUNUNG GEDANGAN - MOJOKERTO',
                  style: const pw.TextStyle(fontSize: 7)),
              pw.Text('TLP. : 0857 332 7112 - 0822 3388 9990',
                  style: const pw.TextStyle(fontSize: 7)),
              pw.Text('0321 - 325831',
                  style: const pw.TextStyle(fontSize: 7)),
            ],
          ),
        ),
      ),
      pw.SizedBox(width: 10),
      pw.Expanded(
        flex: 3,
        child: pw.Center(
          child: pw.Text('INVOICE',
              style: const pw.TextStyle(
                  fontSize: 22, fontWeight: pw.FontWeight.bold)),
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
            _infoRow('NO.', invoice.number),
            _infoRow('TGL.', invoice.createdAt != null
                ? _formatDate(invoice.createdAt!)
                : ''),
            _infoRow('NAMA', invoice.customerName),
            _infoRow('ALAMAT', ''),
            _infoRow('TLP.', invoice.customerPhone),
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

pw.Widget _itemTable(Invoice invoice) {
  return pw.Table(
    border: pw.TableBorder.all(width: 0.8),
    columnWidths: const {
      0: pw.FlexColumnWidth(1),
      1: pw.FlexColumnWidth(2),
      2: pw.FlexColumnWidth(6),
      3: pw.FlexColumnWidth(3),
      4: pw.FlexColumnWidth(3),
    },
    children: [
      pw.TableRow(
        decoration: const pw.BoxDecoration(color: PdfColors.grey300),
        children: [
          _cell('NO.', bold: true, align: pw.TextAlign.center),
          _cell('JUMLAH\nBARANG', bold: true, align: pw.TextAlign.center),
          _cell('KETERANGAN', bold: true, align: pw.TextAlign.center),
          _cell('HARGA\nSATUAN', bold: true, align: pw.TextAlign.center),
          _cell('JUMLAH', bold: true, align: pw.TextAlign.center),
        ],
      ),
      for (var i = 0; i < invoice.items.length; i++)
        pw.TableRow(children: [
          _cell('${i + 1}', align: pw.TextAlign.center),
          _cell('${_trimZero(invoice.items[i].qty)} ${invoice.items[i].unit}',
              align: pw.TextAlign.center),
          _cell(invoice.items[i].name),
          _cell(formatRupiah(invoice.items[i].unitPrice),
              align: pw.TextAlign.right),
          _cell(formatRupiah(invoice.items[i].lineTotal),
              align: pw.TextAlign.right),
        ]),
      // Baris kosong penambah tinggi tabel, meniru nota fisik yang punya
      // baris kosong untuk item tulis tangan bila item digital kurang.
      for (var i = 0; i < (10 - invoice.items.length).clamp(0, 10); i++)
        pw.TableRow(children: [
          _cell(''),
          _cell(''),
          _cell(''),
          _cell(''),
          _cell(''),
        ]),
    ],
  );
}

pw.Widget _totalRow(Invoice invoice) {
  return pw.Table(
    border: const pw.TableBorder(
      left: pw.BorderSide(width: 0.8),
      right: pw.BorderSide(width: 0.8),
      bottom: pw.BorderSide(width: 0.8),
    ),
    columnWidths: const {
      0: pw.FlexColumnWidth(9),
      1: pw.FlexColumnWidth(3),
    },
    children: [
      pw.TableRow(children: [
        _cell('JUMLAH', bold: true, align: pw.TextAlign.right),
        _cell(formatRupiah(invoice.grandTotal),
            bold: true, align: pw.TextAlign.right),
      ]),
    ],
  );
}

pw.Widget _footer() {
  return pw.Row(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      pw.Expanded(
        flex: 7,
        child: _boxed(
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text('CATATAN :',
                  style: const pw.TextStyle(
                      fontSize: 9, fontWeight: pw.FontWeight.bold)),
              pw.SizedBox(height: 3),
              pw.Text(
                  '* No. Laporan Pekerjaan : ..............................................',
                  style: const pw.TextStyle(fontSize: 7)),
              pw.Text(
                  '* Barang yang sudah dibeli tidak dapat ditukar atau dikembalikan',
                  style: const pw.TextStyle(fontSize: 7)),
              pw.Text(
                  '* Pembayaran dapat ditransfer ke Rek. ANDRIAS WARDOYO BCA 0501826391',
                  style: const pw.TextStyle(fontSize: 7)),
              pw.Text(
                  '* Jangan memberi tip kepada petugas kami. Bayarlah sesuai jumlah diatas',
                  style: const pw.TextStyle(fontSize: 7)),
              pw.Text('* Suara Konsumen 082233889990. Pastikan Anda dilayani dengan baik',
                  style: const pw.TextStyle(fontSize: 7)),
            ],
          ),
        ),
      ),
      pw.SizedBox(width: 10),
      pw.Expanded(
        flex: 3,
        child: pw.Column(
          children: [
            pw.Text('HORMAT KAMI',
                style: const pw.TextStyle(
                    fontSize: 9, fontWeight: pw.FontWeight.bold)),
            pw.SizedBox(height: 40),
          ],
        ),
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

String _trimZero(num v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();
