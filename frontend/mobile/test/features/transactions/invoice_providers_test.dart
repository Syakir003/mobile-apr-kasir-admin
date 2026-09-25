import 'package:epos_ac/core/api/api_client.dart';
import 'package:epos_ac/features/transactions/invoice_providers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('buildRecordPaymentBody', () {
    test('membuang invoiceId & cashReceived, mempertahankan sisanya', () {
      final body = buildRecordPaymentBody({
        'invoiceId': 'inv1',
        'method': 'tunai',
        'amount': 50000,
        'cashReceived': 100000,
        'note': 'lunas',
      });

      expect(body, {'method': 'tunai', 'amount': 50000, 'note': 'lunas'});
      expect(body.containsKey('invoiceId'), isFalse);
      expect(body.containsKey('cashReceived'), isFalse);
    });

    test('field opsional yang tidak diisi tidak ikut dikirim', () {
      final body = buildRecordPaymentBody({
        'invoiceId': 'inv1',
        'method': 'qris',
        'amount': 20000,
      });

      expect(body, {'method': 'qris', 'amount': 20000});
    });
  });

  group('sendRecordPayment', () {
    test('POST ke /invoices/:id/payments dengan body bentuk RecordPaymentDto',
        () async {
      String? capturedPath;
      Object? capturedBody;

      await sendRecordPayment(
        (path, {body}) async {
          capturedPath = path;
          capturedBody = body;
          return {'paymentId': 'pay-1', 'status': 'lunas', 'totalPaid': 50000};
        },
        {
          'invoiceId': 'inv1',
          'method': 'tunai',
          'amount': 50000,
          'cashReceived': 100000,
        },
      );

      expect(capturedPath, '/invoices/inv1/payments');
      expect(capturedBody, {'method': 'tunai', 'amount': 50000});
    });

    test('error HTTP (mis. melebihi sisa tagihan) diteruskan apa adanya',
        () async {
      Future<void> call() => sendRecordPayment(
            (path, {body}) async =>
                throw NestApiException(400, 'Melebihi sisa tagihan'),
            {'invoiceId': 'inv1', 'method': 'tunai', 'amount': 999999999},
          );

      await expectLater(
        call,
        throwsA(isA<NestApiException>()
            .having((e) => e.statusCode, 'statusCode', 400)),
      );
    });

    test('token tidak valid/expired (401) diteruskan apa adanya', () async {
      Future<void> call() => sendRecordPayment(
            (path, {body}) async => throw NestApiException(401, 'Belum login.'),
            {'invoiceId': 'inv1', 'method': 'tunai', 'amount': 1000},
          );

      await expectLater(
        call,
        throwsA(isA<NestApiException>()
            .having((e) => e.statusCode, 'statusCode', 401)),
      );
    });
  });
}
