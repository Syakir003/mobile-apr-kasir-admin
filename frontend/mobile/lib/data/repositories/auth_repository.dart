import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/app_user.dart';

abstract interface class AuthRepository {
  Stream<AppUser?> watchCurrentUser();
  Future<void> signIn({required String email, required String password});
  Future<void> signOut();
}

class SupabaseAuthRepository implements AuthRepository {
  SupabaseAuthRepository(this._auth);
  final GoTrueClient _auth;

  @override
  Stream<AppUser?> watchCurrentUser() {
    // onAuthStateChange memancarkan sesi awal saat di-listen, lalu setiap
    // login/logout/refresh token — padanan idTokenChanges() Firebase.
    return _auth.onAuthStateChange.map((state) {
      final session = state.session;
      if (session == null) return null;
      // Klaim `user_role` disuntikkan custom access token hook (Postgres).
      final role = UserRole.fromClaim(readJwtClaim(session.accessToken, 'user_role'));
      if (role == null) return null; // akun tanpa role tidak boleh masuk
      final user = session.user;
      return AppUser(
        uid: user.id,
        email: user.email ?? '',
        displayName: (user.userMetadata?['display_name'] as String?) ?? '',
        role: role,
      );
    });
  }

  @override
  Future<void> signIn({required String email, required String password}) =>
      _auth.signInWithPassword(email: email, password: password);

  @override
  Future<void> signOut() => _auth.signOut();
}

/// Baca satu klaim dari payload JWT tanpa verifikasi tanda tangan —
/// verifikasi terjadi di server (PostgREST + RLS); client hanya butuh
/// nilainya untuk routing/guard UI.
Object? readJwtClaim(String jwt, String name) {
  final parts = jwt.split('.');
  if (parts.length != 3) return null;
  try {
    final payload = json.decode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    if (payload is! Map<String, dynamic>) return null;
    return payload[name];
  } on FormatException {
    return null;
  }
}
