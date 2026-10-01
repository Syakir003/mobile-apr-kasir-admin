import 'dart:convert';

import 'package:epos_ac/core/api/api_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('mapErrorResponse', () {
    test('message string dipakai langsung', () {
      final body = jsonDecode(
        '{"statusCode":404,"message":"Produk tidak ditemukan","error":"Not Found"}',
      );
      final e = mapErrorResponse(404, body);
      expect(e.statusCode, 404);
      expect(e.message, 'Produk tidak ditemukan');
      expect(e.toString(), 'Produk tidak ditemukan');
    });

    test('message array (validasi class-validator) digabung ", "', () {
      final body = jsonDecode(
        '{"statusCode":400,"message":["buyPrice must be an integer",'
        '"buyPrice must not be less than 0"],"error":"Bad Request"}',
      );
      final e = mapErrorResponse(400, body);
      expect(
        e.message,
        'buyPrice must be an integer, buyPrice must not be less than 0',
      );
    });

    test('body kosong/tak dikenal dapat pesan fallback', () {
      final e = mapErrorResponse(500, null);
      expect(e.message, 'Terjadi kesalahan (500).');
    });
  });

  test('respons 2xx: body JSON didekode apa adanya (bentuk item-costs)', () {
    final decoded = jsonDecode(
      '{"kind":"product","refId":"abc-123","buyPrice":15000,"updatedAt":null}',
    ) as Map;
    expect(decoded['kind'], 'product');
    expect(decoded['buyPrice'], 15000);
  });

  test('NestApiConnectionException punya pesan Indonesia default', () {
    expect(
      NestApiConnectionException().message,
      contains('Tidak bisa terhubung ke server'),
    );
  });
}
