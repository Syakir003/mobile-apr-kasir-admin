import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../core/pdf/pdf_theme.dart';
import '../../data/models/ac_unit.dart';

/// Label A6 untuk ditempel di unit AC: barcode Code 128 + identitas unit.
Future<Uint8List> buildUnitLabelPdf(AcUnit unit) async {
  final doc = pw.Document(theme: await pdfTheme());
  final logo = await pdfLogo();
  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a6,
      build: (context) => pw.Center(
        child: pw.Column(
          mainAxisAlignment: pw.MainAxisAlignment.center,
          children: [
            pw.Image(logo, height: 30),
            pw.SizedBox(height: 6),
            pw.Text(
              'Ayub Podo Rukun',
              style: const pw.TextStyle(
                fontSize: 14,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
            pw.SizedBox(height: 10),
            // Code 128: padat & terbaca kamera HP maupun scanner gun standar.
            // Teks nilainya dicetak terpisah di bawah (pakai font tema), jadi
            // `drawText` bawaan barcode dimatikan supaya tak dobel & tak
            // menarik font Courier tanpa dukungan Unicode.
            pw.BarcodeWidget(
              barcode: pw.Barcode.code128(),
              data: unit.barcodeValue,
              width: 240,
              height: 80,
              drawText: false,
            ),
            pw.SizedBox(height: 8),
            pw.Text(unit.barcodeValue, style: const pw.TextStyle(fontSize: 12)),
            pw.SizedBox(height: 6),
            pw.Text('${unit.brand} ${unit.model}'),
            if (unit.roomLocation.isNotEmpty) pw.Text(unit.roomLocation),
          ],
        ),
      ),
    ),
  );
  return doc.save();
}
