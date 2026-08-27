import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../core/pdf/pdf_theme.dart';
import '../../core/utils/currency.dart';
import '../../data/models/invoice.dart';
import '../../data/models/manual_payment.dart';

/// Struk 80mm (roll80) untuk sebuah [invoice] beserta daftar [payments].
/// Dipakai lewat `Printing.layoutPdf` (pola `unit_label_pdf.dart`). Struk
/// bersifat self-contained: seluruh angka diambil dari snapshot invoice.
Future<Uint8List> buildReceiptPdf(
  Invoice invoice,
  List<ManualPayment> payments,
) async {
  final doc = pw.Document(theme: await pdfTheme());
  final logo = await pdfLogo();
  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.roll80,
      margin: const pw.EdgeInsets.all(8),
      build: (context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          pw.Center(child: pw.Image(logo, height: 24)),
          pw.SizedBox(height: 4),
          pw.Center(
            child: pw.Text(
              'Ayub Podo Rukun',
              style: const pw.TextStyle(
                  fontSize: 12, fontWeight: pw.FontWeight.bold),
            ),
          ),
          pw.SizedBox(height: 4),
          pw.Center(
            child:
                pw.Text(invoice.number, style: const pw.TextStyle(fontSize: 9)),
          ),
          if (invoice.createdAt != null)
            pw.Center(
              child: pw.Text(
                _formatDate(invoice.createdAt!),
                style: const pw.TextStyle(fontSize: 8),
              ),
            ),
          pw.Divider(),
          pw.Text(invoice.customerName, style: const pw.TextStyle(fontSize: 9)),
          if (invoice.customerPhone.isNotEmpty)
            pw.Text(invoice.customerPhone,
                style: const pw.TextStyle(fontSize: 8)),
          pw.Divider(),
          for (final item in invoice.items) _itemRow(item),
          pw.Divider(),
          _amountRow('Subtotal', invoice.subtotal),
          if (invoice.discount > 0) _amountRow('Diskon', -invoice.discount),
          if (invoice.taxAmount > 0)
            _amountRow(
                'Pajak (${_trimZero(invoice.taxPercent)}%)', invoice.taxAmount),
          if (invoice.transportFee > 0)
            _amountRow('Transport', invoice.transportFee),
          _amountRow('Total', invoice.grandTotal, bold: true),
          pw.Divider(),
          if (payments.isNotEmpty) ...[
            pw.Text('Pembayaran',
                style: const pw.TextStyle(
                    fontSize: 9, fontWeight: pw.FontWeight.bold)),
            for (final p in payments)
              if (p.change > 0) ...[
                _amountRow('${p.method.label} (diterima)', p.cashReceived!),
                _amountRow('Kembali', p.change),
              ] else
                _amountRow(p.method.label, p.amount),
            pw.SizedBox(height: 2),
          ],
          _amountRow('Dibayar', invoice.totalPaid),
          _amountRow('Sisa', invoice.sisa, bold: true),
          pw.SizedBox(height: 4),
          pw.Center(
            child: pw.Text('Status: ${invoice.status.label}',
                style: const pw.TextStyle(fontSize: 9)),
          ),
          if (invoice.notes != null && invoice.notes!.trim().isNotEmpty) ...[
            pw.SizedBox(height: 4),
            pw.Text('Catatan: ${invoice.notes}',
                style: const pw.TextStyle(fontSize: 8)),
          ],
        ],
      ),
    ),
  );
  return doc.save();
}

pw.Widget _itemRow(InvoiceItem item) {
  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.stretch,
    children: [
      pw.Text(item.name, style: const pw.TextStyle(fontSize: 9)),
      pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(
            '${_trimZero(item.qty)} ${item.unit} x ${formatRupiah(item.unitPrice)}',
            style: const pw.TextStyle(fontSize: 8),
          ),
          pw.Text(formatRupiah(item.lineTotal),
              style: const pw.TextStyle(fontSize: 8)),
        ],
      ),
    ],
  );
}

pw.Widget _amountRow(String label, int value, {bool bold = false}) {
  final style = pw.TextStyle(
    fontSize: 9,
    fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
  );
  return pw.Row(
    mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
    children: [
      pw.Text(label, style: style),
      pw.Text(formatRupiah(value), style: style),
    ],
  );
}

String _formatDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// `2.0` -> `'2'`, `2.5` -> `'2.5'`. Untuk qty & persen di struk.
String _trimZero(num v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();
