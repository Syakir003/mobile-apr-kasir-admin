import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/features/transactions/delivery_note_pdf.dart';

Invoice _invoice() => const Invoice(
      id: 'inv-1',
      number: 'INV-20260805-0001',
      transactionId: 'trx-1',
      memberId: 'mbr-1',
      customerName: 'Café Séverine',
      customerPhone: '+6281298765400',
      status: InvoiceStatus.lunas,
      subtotal: 6000000,
      grandTotal: 6000000,
      totalPaid: 6000000,
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
        InvoiceItem(
          kind: 'service',
          refId: 'svc-1',
          name: 'Pemasangan',
          unit: 'unit',
          qty: 2,
          unitPrice: 0,
          lineTotal: 0,
        ),
      ],
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('surat jalan memakai font ber-Unicode, bukan Helvetica bawaan',
      () async {
    final bytes = await buildDeliveryNotePdf(_invoice());
    final raw = latin1.decode(bytes, allowInvalid: true);

    expect(raw.contains('Roboto'), isTrue,
        reason: 'font Roboto tidak tertanam di PDF');
    expect(raw.contains('Helvetica'), isFalse,
        reason: 'masih memakai font tanpa dukungan Unicode');
  });

  test('surat jalan berhasil dibangun', () async {
    final bytes = await buildDeliveryNotePdf(_invoice());
    expect(bytes.length, greaterThan(1000));
  });
}
