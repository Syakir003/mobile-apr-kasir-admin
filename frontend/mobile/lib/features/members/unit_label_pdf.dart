import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../data/models/ac_unit.dart';

/// Label A6 untuk ditempel di unit AC: QR + barcode + identitas unit.
Future<Uint8List> buildUnitLabelPdf(AcUnit unit) async {
  final doc = pw.Document();
  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a6,
      build: (context) => pw.Center(
        child: pw.Column(
          mainAxisAlignment: pw.MainAxisAlignment.center,
          children: [
            pw.Text(
              'Ayub Podo Rukun',
              style: const pw.TextStyle(
                fontSize: 14,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
            pw.SizedBox(height: 10),
            pw.BarcodeWidget(
              barcode: pw.Barcode.qrCode(),
              data: unit.barcodeValue,
              width: 110,
              height: 110,
            ),
            pw.SizedBox(height: 10),
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
