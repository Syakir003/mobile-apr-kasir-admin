import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../core/pdf/pdf_theme.dart';
import '../../data/models/invoice.dart';

/// Surat Jalan A4 (pola nota fisik "CV. AYUB PODO RUKUN"): dua salinan
/// identik dalam satu halaman (pengirim & penerima), dipotong di rumah.
/// Baris barang memakai item [invoice] yang benar-benar dikirim — jasa
/// (mis. ongkos pemasangan) tidak "dikirim", jadi dikecualikan.
Future<Uint8List> buildDeliveryNotePdf(Invoice invoice) async {
  final doc = pw.Document(theme: await pdfTheme());
  final logo = await pdfLogo();
  final barang = invoice.items.where((i) => i.kind != 'service').toList();

  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(24),
      build: (context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          _half(invoice, barang, logo),
          pw.SizedBox(height: 12),
          pw.Divider(borderStyle: pw.BorderStyle.dashed),
          pw.SizedBox(height: 12),
          _half(invoice, barang, logo),
        ],
      ),
    ),
  );
  return doc.save();
}

pw.Widget _half(
    Invoice invoice, List<InvoiceItem> barang, pw.MemoryImage logo) {
  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.stretch,
    children: [
      pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Expanded(
            flex: 5,
            child: pw.Row(
              children: [
                pw.Image(logo, height: 36),
                pw.SizedBox(width: 8),
                pw.Expanded(
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text('CV. AYUB PODO RUKUN',
                          style: const pw.TextStyle(
                              fontSize: 12, fontWeight: pw.FontWeight.bold)),
                      pw.Text('Penjualan • Service • Spare Part • Rental AC',
                          style: const pw.TextStyle(
                              fontSize: 7, fontWeight: pw.FontWeight.bold)),
                      pw.Text('JL. GUNUNG ANYAR RT. 01 RW. 06',
                          style: const pw.TextStyle(fontSize: 7)),
                      pw.Text('KEL. GUNUNG GEDANGAN - MOJOKERTO',
                          style: const pw.TextStyle(fontSize: 7)),
                      pw.Text('TLP. : 0857 332 7112 - 0822 3388 9990',
                          style: const pw.TextStyle(fontSize: 7)),
                      pw.Text('FAX. : (0321) 325831',
                          style: const pw.TextStyle(fontSize: 7)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          pw.Expanded(
            flex: 4,
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.end,
              children: [
                pw.Text('Kepada Yth. :',
                    style: const pw.TextStyle(fontSize: 8)),
                pw.Text(invoice.customerName,
                    style: const pw.TextStyle(fontSize: 9)),
                if (invoice.customerPhone.isNotEmpty)
                  pw.Text(invoice.customerPhone,
                      style: const pw.TextStyle(fontSize: 8)),
              ],
            ),
          ),
        ],
      ),
      pw.SizedBox(height: 8),
      pw.Text('SURAT JALAN : No. ${invoice.number}',
          style: const pw.TextStyle(
              fontSize: 12, fontWeight: pw.FontWeight.bold)),
      pw.SizedBox(height: 6),
      pw.Table(
        border: pw.TableBorder.all(width: 0.8),
        columnWidths: const {
          0: pw.FlexColumnWidth(1),
          1: pw.FlexColumnWidth(2),
          2: pw.FlexColumnWidth(7),
        },
        children: [
          pw.TableRow(
            decoration: const pw.BoxDecoration(color: PdfColors.grey300),
            children: [
              _cell('NO.', bold: true, align: pw.TextAlign.center),
              _cell('BANYAKNYA', bold: true, align: pw.TextAlign.center),
              _cell('NAMA BARANG', bold: true, align: pw.TextAlign.center),
            ],
          ),
          for (var i = 0; i < barang.length; i++)
            pw.TableRow(children: [
              _cell('${i + 1}', align: pw.TextAlign.center),
              _cell('${_trimZero(barang[i].qty)} ${barang[i].unit}',
                  align: pw.TextAlign.center),
              _cell(barang[i].name),
            ]),
          for (var i = 0; i < (6 - barang.length).clamp(0, 6); i++)
            pw.TableRow(children: [_cell(''), _cell(''), _cell('')]),
        ],
      ),
      pw.SizedBox(height: 24),
      pw.Row(
        children: [
          pw.Expanded(
            child: pw.Column(children: [
              pw.Text('Tanda Terima,',
                  style: const pw.TextStyle(fontSize: 9)),
              pw.SizedBox(height: 32),
              pw.Text('...................................',
                  style: const pw.TextStyle(fontSize: 9)),
            ]),
          ),
          pw.Expanded(
            child: pw.Column(children: [
              pw.Text('Hormat Kami,', style: const pw.TextStyle(fontSize: 9)),
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

String _trimZero(num v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();
