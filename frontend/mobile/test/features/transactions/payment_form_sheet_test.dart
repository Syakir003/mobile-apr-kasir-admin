import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/features/transactions/invoice_providers.dart';
import 'package:epos_ac/features/transactions/payment_form_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const _invoice = Invoice(
  id: 'inv1',
  number: 'INV-20260712-0001',
  transactionId: 't1',
  memberId: 'm1',
  customerName: 'Budi',
  customerPhone: '+6281234567890',
  subtotal: 50000,
  grandTotal: 50000,
  totalPaid: 0,
);

Widget _host({
  required Invoice invoice,
  required Future<void> Function(Map<String, dynamic>) caller,
}) {
  return ProviderScope(
    overrides: [
      recordPaymentCallerProvider.overrideWithValue(caller),
    ],
    child: MaterialApp(
      home: Scaffold(body: PaymentFormSheet(invoice: invoice)),
    ),
  );
}

void _useTallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('nominal kosong: validasi muncul, caller tidak terpanggil',
      (tester) async {
    _useTallViewport(tester);
    var called = false;
    await tester.pumpWidget(_host(
      invoice: _invoice,
      caller: (payload) async {
        called = true;
      },
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('pay-submit')));
    await tester.pumpAndSettle();

    expect(find.text('Nominal harus lebih dari 0'), findsOneWidget);
    expect(called, isFalse);
  });

  testWidgets(
      'tunai 100000 pada sisa 50000: tampil kembalian & kirim amount 50000',
      (tester) async {
    _useTallViewport(tester);
    Map<String, dynamic>? captured;
    await tester.pumpWidget(_host(
      invoice: _invoice,
      caller: (payload) async {
        captured = payload;
      },
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('amount')), '100000');
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('change')), findsOneWidget);
    expect(find.text('Kembalian: Rp 50.000'), findsOneWidget);

    await tester.tap(find.byKey(const Key('pay-submit')));
    await tester.pumpAndSettle();

    expect(captured, isNotNull);
    expect(captured!['invoiceId'], 'inv1');
    expect(captured!['method'], 'tunai');
    expect(captured!['amount'], 50000);
  });
}
