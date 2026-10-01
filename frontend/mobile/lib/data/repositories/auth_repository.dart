import '../../core/api/api_client.dart';
import '../../core/auth/session_store.dart';
import '../models/app_user.dart';

abstract interface class AuthRepository {
  Stream<AppUser?> watchCurrentUser();
  Future<void> signIn({required String email, required String password});
  Future<void> signOut();

  /// Validasi ulang sesi tersimpan ke server (role/status akun terbaru).
  Future<void> refresh();

  Future<void> changePassword({required String currentPassword, required String newPassword});
}

/// Login lewat backend Nest (POST /auth/login), sesi di [SessionStore].
class NestAuthRepository implements AuthRepository {
  NestAuthRepository(this._api, this._session);

  final ApiClient _api;
  final SessionStore _session;

  @override
  Stream<AppUser?> watchCurrentUser() async* {
    yield _session.user;
    yield* _session.changes;
  }

  @override
  Future<void> signIn({required String email, required String password}) async {
    final res = await _api.postPublic('/auth/login', body: {'email': email.trim(), 'password': password});
    final token = res is Map ? res['accessToken'] : null;
    final user = res is Map ? userFromJson(res['user']) : null;
    if (token is! String || user == null) {
      throw NestApiException(500, 'Respons login tidak dikenali.');
    }
    await _session.save(token, user);
  }

  @override
  Future<void> signOut() => _session.clear();

  /// GET /auth/me: role & status akun dibaca ulang dari DB oleh server. 401
  /// (token kedaluwarsa/akun nonaktif) sudah menghapus sesi di [ApiClient];
  /// gagal koneksi = tetap pakai sesi tersimpan (app bisa dibuka offline).
  @override
  Future<void> refresh() async {
    if (_session.token == null) return;
    try {
      final me = userFromJson(await _api.get('/auth/me'));
      if (me == null) {
        await _session.clear();
      } else {
        await _session.updateUser(me);
      }
    } on NestApiConnectionException {
      // offline — biarkan sesi tersimpan
    } on NestApiException {
      // 401 sudah ditangani ApiClient; error lain gak boleh bikin logout
    }
  }

  /// Server menolak semua token yang terbit sebelum password diganti
  /// (passwordChangedAt) dan membalas token + user baru — WAJIB disimpan,
  /// kalau gak user langsung kelempar ke login di request berikutnya.
  @override
  Future<void> changePassword({required String currentPassword, required String newPassword}) async {
    final res = await _api.patch('/auth/me/password', body: {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });
    final token = res is Map ? res['accessToken'] : null;
    final user = res is Map ? userFromJson(res['user']) : null;
    if (token is String && user != null) await _session.save(token, user);
  }
}

/// Aturan sama persis dengan backend (`IsStrongPassword` Nest & form web):
/// minimal 8 karakter, wajib ada huruf DAN angka. Null = valid.
String? validateStrongPassword(String? v) {
  if (v == null || v.length < 8) return 'Password minimal 8 karakter';
  if (!RegExp(r'^(?=.*[A-Za-z])(?=.*\d).+$').hasMatch(v)) {
    return 'Password wajib kombinasi huruf dan angka';
  }
  return null;
}
