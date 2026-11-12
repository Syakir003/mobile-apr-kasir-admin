import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/invoice.dart';
import 'package:epos_ac/data/models/manual_payment.dart';
import 'package:epos_ac/features/transactions/invoice_detail_screen.dart';
import 'package:epos_ac/features/transactions/invoice_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Invoice _inv(String phone) => Invoice(
      id: 'inv1',
      number: 'INV-1',
      transactionId: 't1',
      memberId: 'm1',
      customerName: 'Budi',
      customerPhone: phone,
      subtotal: 100000,
      grandTotal: 100000,
      totalPaid: 0,
      status: InvoiceStatus.belumDibayar,
    );

Widget _app(String phone, List<String> sent) => ProviderScope(
      overrides: [
        invoiceProvider.overrideWith((ref, id) => Stream.value(_inv(phone))),
        invoicePaymentsProvider.overrideWith((ref, id) => Stream.value(const <ManualPayment>[])),
        sendInvoiceWhatsappProvider.overrideWithValue((id) async => sent.add(id)),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const InvoiceDetailScreen(invoiceId: 'inv1')),
    );

void main() {
  testWidgets('Kirim WA: konfirmasi lalu memanggil endpoint dengan id invoice', (t) async {
    final sent = <String>[];
    await t.pumpWidget(_app('08123456789', sent));
    await t.pumpAndSettle();

    await t.scrollUntilVisible(find.byKey(const Key('send-wa')), 200, scrollable: find.byType(Scrollable).first);
    await t.tap(find.byKey(const Key('send-wa')));
    await t.pumpAndSettle();
    expect(find.textContaining('08123456789'), findsWidgets);
    expect(sent, isEmpty); // belum dikonfirmasi

    await t.tap(find.byKey(const Key('send-wa-confirm')));
    await t.pumpAndSettle();
    expect(sent, ['inv1']);
    expect(find.text('Struk terkirim lewat WhatsApp.'), findsOneWidget);
  });

  testWidgets('tanpa nomor HP: tombol Kirim WA mati dengan petunjuk', (t) async {
    await t.pumpWidget(_app('', []));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.byKey(const Key('send-wa')), 200, scrollable: find.byType(Scrollable).first);
    expect(t.widget<OutlinedButton>(find.byKey(const Key('send-wa'))).onPressed, isNull);
    expect(find.textContaining('Isi nomor HP pelanggan'), findsOneWidget);
  });
}
