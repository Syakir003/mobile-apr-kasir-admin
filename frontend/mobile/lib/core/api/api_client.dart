import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import '../auth/session_store.dart';

// =============================================================================
// Base URL backend NestJS (Nest/epos-backend). Belum ada deployment produksi
// yang terdokumentasi di repo ini — GANTI _cloudUrl begitu backend sudah
// online. Override lewat `--dart-define=NEST_API_URL=...`, sama seperti pola
// SUPABASE_URL di supabase_bootstrap.dart. Untuk dev lokal (`npm run
// start:dev`, default port 3000): dari emulator Android pakai
// `http://10.0.2.2:3000`, dari HP fisik pakai `http://<ip-lan>:3000`.
// =============================================================================
const _cloudUrl = 'https://api.epos-ac.example'; // TODO: isi URL deploy Nest yang sebenarnya
const _defaultBaseUrl = String.fromEnvironment('NEST_API_URL', defaultValue: _cloudUrl);

/// Error dari backend Nest, dibentuk dari body `{ statusCode, message, error }`
/// yang selalu dikirim `HttpExceptionFilter` untuk respons 4xx/5xx. `message`
/// bisa berupa string (error biasa) atau array of string (validasi
/// class-validator) — keduanya sudah digabung jadi satu string di sini.
class NestApiException implements Exception {
  NestApiException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  @override
  String toString() => message;
}

/// Tidak ada respons sama sekali dari server (jaringan putus/timeout),
/// berbeda dari [NestApiException] yang berarti server sempat membalas.
class NestApiConnectionException implements Exception {
  NestApiConnectionException([
    this.message = 'Tidak bisa terhubung ke server. Periksa koneksi internet Anda.',
  ]);

  final String message;

  @override
  String toString() => message;
}

/// Bentuk [NestApiException] dari body respons error Nest. Dipisah dari
/// [ApiClient] supaya bisa diuji tanpa mock HTTP sungguhan.
NestApiException mapErrorResponse(int statusCode, Object? body) {
  final rawMessage = body is Map ? body['message'] : null;
  final message = switch (rawMessage) {
    List<dynamic> list => list.join(', '),
    String s when s.isNotEmpty => s,
    _ => 'Terjadi kesalahan ($statusCode).',
  };
  return NestApiException(statusCode, message);
}

/// Client HTTP tipis ke backend NestJS.
///
/// Token login dibaca dari [SessionStore] (hasil POST /auth/login Nest).
/// Respons 401 = token kedaluwarsa (8 jam) / akun dinonaktifkan -> sesi
/// dihapus, router otomatis balik ke layar login. Belum ada sesi = error
/// jelas, bukan request tanpa auth.
class ApiClient {
  const ApiClient([this._baseUrl = _defaultBaseUrl]);

  final String _baseUrl;

  /// Dipakai membangun URL absolut ke aset statis Nest (mis. foto job di
  /// `/uploads/...`) yang tidak lewat [_send] — lihat `signedPhotoUrl` di
  /// `NestJobRepository`.
  String get baseUrl => _baseUrl;

  Future<dynamic> get(String path) => _send('GET', path);
  Future<dynamic> post(String path, {Object? body}) => _send('POST', path, body: body);
  Future<dynamic> put(String path, {Object? body}) => _send('PUT', path, body: body);
  Future<dynamic> patch(String path, {Object? body}) => _send('PATCH', path, body: body);
  Future<dynamic> delete(String path, {Object? body}) => _send('DELETE', path, body: body);

  /// Unggah file (`multipart/form-data`) — dipakai endpoint upload foto Nest
  /// yang butuh file biner + field lain sekaligus (mis. `kind`), beda dari
  /// [_send] yang cuma JSON. Auth & pemetaan error sama seperti [_send];
  /// timeout lebih longgar (foto s.d. 10MB, lihat limit di Nest) daripada
  /// request JSON biasa.
  Future<dynamic> postMultipart(
    String path, {
    required String fileField,
    required List<int> bytes,
    required String filename,
    required String contentType,
    Map<String, String> fields = const {},
  }) async {
    final token = SessionStore.instance.token;
    if (token == null) {
      throw NestApiException(401, 'Belum login.');
    }

    final request = http.MultipartRequest('POST', Uri.parse('$_baseUrl$path'))
      ..headers['Authorization'] = 'Bearer $token'
      ..fields.addAll(fields)
      ..files.add(http.MultipartFile.fromBytes(
        fileField,
        bytes,
        filename: filename,
        contentType: MediaType.parse(contentType),
      ));

    http.Response response;
    try {
      final streamed = await request.send().timeout(const Duration(seconds: 30));
      response = await http.Response.fromStream(streamed);
    } catch (e) {
      throw NestApiConnectionException();
    }

    return _handle(response);
  }

  /// Request TANPA token — cuma buat POST /auth/login.
  Future<dynamic> postPublic(String path, {Object? body}) async {
    http.Response response;
    try {
      response = await http
          .post(
            Uri.parse('$_baseUrl$path'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 15));
    } catch (e) {
      throw NestApiConnectionException();
    }
    final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) return decoded;
    throw mapErrorResponse(response.statusCode, decoded);
  }

  Future<dynamic> _handle(http.Response response) async {
    final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }
    if (response.statusCode == 401) {
      await SessionStore.instance.clear();
    }
    throw mapErrorResponse(response.statusCode, decoded);
  }

  Future<dynamic> _send(String method, String path, {Object? body}) async {
    final token = SessionStore.instance.token;
    if (token == null) {
      throw NestApiException(401, 'Belum login.');
    }

    final uri = Uri.parse('$_baseUrl$path');
    final headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
    final encodedBody = body == null ? null : jsonEncode(body);

    http.Response response;
    try {
      response = await switch (method) {
            'GET' => http.get(uri, headers: headers),
            'POST' => http.post(uri, headers: headers, body: encodedBody),
            'PUT' => http.put(uri, headers: headers, body: encodedBody),
            'PATCH' => http.patch(uri, headers: headers, body: encodedBody),
            'DELETE' => http.delete(uri, headers: headers, body: encodedBody),
            _ => throw ArgumentError('Method HTTP tak dikenal: $method'),
          }
          .timeout(const Duration(seconds: 15));
    } catch (e) {
      // Apa pun sebabnya (SocketException, TimeoutException, ClientException
      // dari package:http, dll.) — server tidak sempat membalas sama sekali,
      // jadi bukan urusan mapErrorResponse.
      throw NestApiConnectionException();
    }

    return _handle(response);
  }
}
