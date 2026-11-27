import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../core/api/api_client.dart';
import '../../core/pdf/pdf_theme.dart';

/// Satu label unit AC di gudang. [roleText] "INDOOR"/"OUTDOOR" atau kosong.
class StockLabel {
  const StockLabel({
    required this.code,
    required this.qrToken,
    required this.name,
    this.roleText = '',
  });

  final String code;
  final String qrToken;
  final String name;
  final String roleText;
}

/// Baris `GET /stock/batches/:id/units` -> label.
List<StockLabel> stockLabelsFrom(List rows, {required String name, String? role}) => [
      for (final r in rows.cast<Map>())
        StockLabel(
          code: '${r['unitCode']}',
          qrToken: '${r['qrToken']}',
          name: name,
          roleText: (role ?? '').toUpperCase(),
        ),
    ];

/// Label A6, satu halaman per unit. QR berisi token yang discan saat Keluar
/// Gudang; nama & peran dicetak supaya Indoor/Outdoor tidak tertukar.
// ponytail: ukuran A6 sama dengan label AC pelanggan; ganti pageFormat bila stiker gudang sudah ditentukan.
Future<Uint8List> buildStockLabelsPdf(List<StockLabel> labels) async {
  final doc = pw.Document(theme: await pdfTheme());
  for (final label in labels) {
    doc.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a6,
        build: (context) => pw.Center(
          child: pw.Column(
            mainAxisAlignment: pw.MainAxisAlignment.center,
            children: [
              if (label.roleText.isNotEmpty)
                pw.Text(label.roleText,
                    style: const pw.TextStyle(fontSize: 28, fontWeight: pw.FontWeight.bold)),
              pw.SizedBox(height: 8),
              pw.Text(label.name, textAlign: pw.TextAlign.center, style: const pw.TextStyle(fontSize: 13)),
              pw.SizedBox(height: 12),
              pw.BarcodeWidget(barcode: pw.Barcode.qrCode(), data: label.qrToken, width: 150, height: 150),
              pw.SizedBox(height: 8),
              pw.Text(label.code, style: const pw.TextStyle(fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }
  return doc.save();
}

/// Ambil unit tiap batch lalu buka dialog cetak Android.
Future<void> printBatchLabels(List<({String batchId, String name, String? role})> batches) async {
  final labels = <StockLabel>[];
  for (final b in batches) {
    final rows = await const ApiClient().get('/stock/batches/${b.batchId}/units') as List;
    labels.addAll(stockLabelsFrom(rows, name: b.name, role: b.role));
  }
  if (labels.isEmpty) throw Exception('Tidak ada unit untuk dicetak.');
  await Printing.layoutPdf(onLayout: (_) => buildStockLabelsPdf(labels), name: 'Label-stok');
}
