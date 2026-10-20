import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../data/models/app_user.dart';

/// Penyimpan kunci-nilai untuk sesi. Default: keystore/keychain perangkat
/// (flutter_secure_storage) — token login JANGAN disimpan di penyimpanan
/// biasa. Di test diganti [MemoryKeyValueStore] (plugin gak ada di test).
abstract interface class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class SecureKeyValueStore implements KeyValueStore {
  const SecureKeyValueStore();
  static const _storage = FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class MemoryKeyValueStore implements KeyValueStore {
  final _data = <String, String>{};
  @override
  Future<String?> read(String key) async => _data[key];
  @override
  Future<void> write(String key, String value) async => _data[key] = value;
  @override
  Future<void> delete(String key) async => _data.remove(key);
}

/// Sesi login backend Nest: access token (JWT, berlaku 8 jam, tanpa refresh
/// token — sama kayak sesi web) + profil user. Satu instance global dipakai
/// [ApiClient] (header Authorization) dan `NestAuthRepository` (status login).
class SessionStore {
  SessionStore([this._storage = const SecureKeyValueStore()]);

  /// Instance yang dipakai app. Test boleh menggantinya.
  static SessionStore instance = SessionStore();

  static const _key = 'epos_session_v1';

  final KeyValueStore _storage;
  final _changes = StreamController<AppUser?>.broadcast();
  String? _token;
  AppUser? _user;

  String? get token => _token;
  AppUser? get user => _user;

  /// Tiap login/logout/perubahan profil. Belum memancarkan nilai awal —
  /// pembaca yang butuh nilai sekarang baca [user] dulu.
  Stream<AppUser?> get changes => _changes.stream;

  /// Muat sesi tersimpan (dipanggil sekali di `main`). Data rusak = dianggap
  /// belum login.
  Future<void> load() async {
    try {
      final raw = await _storage.read(_key);
      if (raw == null) return;
      final map = jsonDecode(raw) as Map<String, dynamic>;
      final user = userFromJson(map['user']);
      final token = map['token'];
      if (token is String && token.isNotEmpty && user != null) {
        _token = token;
        _user = user;
      }
    } catch (_) {
      await _storage.delete(_key);
    }
  }

  Future<void> save(String token, AppUser user) async {
    _token = token;
    _user = user;
    await _storage.write(_key, jsonEncode({'token': token, 'user': userToJson(user)}));
    _changes.add(user);
  }

  /// Ganti profil (mis. hasil GET /auth/me) tanpa ganti token.
  Future<void> updateUser(AppUser user) async {
    final token = _token;
    if (token == null) return;
    await save(token, user);
  }

  Future<void> clear() async {
    final hadSession = _token != null;
    _token = null;
    _user = null;
    await _storage.delete(_key);
    if (hadSession) _changes.add(null);
  }
}

/// Bentuk `user` dari POST /auth/login dan GET /auth/me Nest:
/// `{ id, email?, role, displayName }`. Role tak dikenal = null (gak boleh masuk).
AppUser? userFromJson(Object? json) {
  if (json is! Map) return null;
  final role = UserRole.fromClaim(json['role']);
  final id = json['id'];
  if (role == null || id is! String || id.isEmpty) return null;
  return AppUser(
    uid: id,
    email: (json['email'] as String?) ?? '',
    displayName: (json['displayName'] as String?) ?? '',
    role: role,
  );
}

Map<String, dynamic> userToJson(AppUser u) => {
      'id': u.uid,
      'email': u.email,
      'displayName': u.displayName,
      'role': u.role.name,
    };
