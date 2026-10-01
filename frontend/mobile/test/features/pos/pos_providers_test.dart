import 'package:epos_ac/core/api/api_client.dart';
import 'package:epos_ac/features/pos/pos_providers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('sendCheckout', () {
    test('mengirim payload apa adanya ke POST /pos/checkout', () async {
      String? capturedPath;
      Object? capturedBody;
      final payload = <String, dynamic>{
        'customer': {'name': 'Budi', 'phone': '+6281234567890'},
        'items': [
          {'kind': 'product', 'refId': 'p1', 'qty': 2},
        ],
        'discount': 0,
        'taxPercent': 0,
        'transportFee': 0,
      };

      final result = await sendCheckout(
        (path, {body}) async {
          capturedPath = path;
          capturedBody = body;
          return {'invoiceId': 'inv-1', 'invoiceNumber': 'INV-20260918-0001'};
        },
        payload,
      );

      expect(capturedPath, '/pos/checkout');
      expect(capturedBody, same(payload));
      expect(result.invoiceId, 'inv-1');
      expect(result.invoiceNumber, 'INV-20260918-0001');
    });

    test('error HTTP (mis. diskon melebihi subtotal) diteruskan apa adanya',
        () async {
      Future<void> call() => sendCheckout(
            (path, {body}) async =>
                throw NestApiException(400, 'Diskon melebihi subtotal'),
            const {},
          );

      await expectLater(
        call,
        throwsA(isA<NestApiException>()
            .having((e) => e.statusCode, 'statusCode', 400)),
      );
    });

    test('token tidak valid/expired (401) diteruskan apa adanya', () async {
      Future<void> call() => sendCheckout(
            (path, {body}) async => throw NestApiException(401, 'Belum login.'),
            const {},
          );

      await expectLater(
        call,
        throwsA(isA<NestApiException>()
            .having((e) => e.statusCode, 'statusCode', 401)),
      );
    });
  });
}
