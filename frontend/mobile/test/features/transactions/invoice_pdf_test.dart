import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/features/transactions/invoice_pdf.dart';

Invoice _invoice() => const Invoice(
      id: 'inv-1',
      number: 'INV-20260805-0001',
      transactionId: 'trx-1',
      memberId: 'mbr-1',
      customerName: 'Café Séverine — Ünit ×2',
      customerPhone: '+6281298765400',
      status: InvoiceStatus.lunas,
      subtotal: 6465000,
      discount: 200000,
      taxPercent: 11,
      taxAmount: 689150,
      transportFee: 50000,
      grandTotal: 7004150,
      totalPaid: 7004150,
      items: [
        InvoiceItem(
          kind: 'product',
          refId: 'prd-1',
          name: 'Panasonic CS-YN5 1/2 PK',
          unit: 'unit',
          qty: 2,
          unitPrice: 3000000,
          lineTotal: 6000000,
        ),
      ],
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('invoice A4 memakai font ber-Unicode, bukan Helvetica bawaan',
      () async {
    final bytes = await buildInvoicePdf(_invoice());
    final raw = latin1.decode(bytes, allowInvalid: true);

    expect(raw.contains('Roboto'), isTrue,
        reason: 'font Roboto tidak tertanam di PDF');
    expect(raw.contains('Helvetica'), isFalse,
        reason: 'masih memakai font tanpa dukungan Unicode');
  });

  test('invoice A4 berhasil dibangun untuk nama pelanggan non-ASCII',
      () async {
    final bytes = await buildInvoicePdf(_invoice());
    expect(bytes.length, greaterThan(1000));
  });
}
