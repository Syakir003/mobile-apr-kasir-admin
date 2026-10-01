import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/supabase/session_gate.dart';
import '../../core/utils/snake_keys.dart';
import '../../data/models/managed_user.dart';

/// Seluruh akun (admin saja — rute '/users' dikunci admin di redirect.dart).
/// `GET /users`, dimuat sekali per sesi; mutasi di bawah me-refetch lewat
/// invalidate.
final managedUsersProvider = StreamProvider<List<ManagedUser>>((ref) {
  return streamWhenSignedIn(ref, () async* {
    final rows = await const ApiClient().get('/users') as List;
    yield [
      for (final r in rows)
        ManagedUser.fromMap((r as Map)['id'] as String, snakeKeys(r)),
    ];
  });
});

/// `PATCH /users/:id` + `PATCH /users/:id/toggle-active` — pengganti RPC
/// `update_user_account` pada migrasi Flutter -> Nest. Backend SENGAJA
/// membelah RPC lama jadi dua endpoint terpisah (lihat komentar
/// `UpdateUserDto`/`UsersService.toggleActive`): pengaman "gak bisa
/// menonaktifkan diri sendiri" & "admin aktif terakhir" cuma berlaku di
/// toggle-active, biar gak bisa dilewatin lewat endpoint update biasa. Dua
/// panggilan berurutan ini TIDAK atomik seperti RPC lama — kalau panggilan
/// kedua gagal (mis. kena pengaman admin-terakhir), role/nama sudah
/// tersimpan tapi status aktif belum; error dari panggilan yang gagal
/// diteruskan apa adanya ke pemanggil.
final updateUserAccountCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final id = payload['userId'] as String;
    const api = ApiClient();
    await api.patch('/users/$id', body: {
      'role': payload['role'],
      'displayName': payload['displayName'],
    });
    await api.patch('/users/$id/toggle-active', body: {'active': payload['active']});
    ref.invalidate(managedUsersProvider);
  };
});

/// `POST /users` (admin) — pengganti Edge Function `admin-users` aksi
/// `create` pada migrasi Flutter -> Nest. Nest membuat akun lewat Admin API
/// GoTrue (service_role di server, bukan di aplikasi) lalu menimpa profil
/// `public.users` — port 1:1 dari Edge Function lama, lihat `UsersService.create`.
final createUserAccountCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> body)>((ref) {
  return (body) async {
    await const ApiClient().post('/users', body: body);
    ref.invalidate(managedUsersProvider);
  };
});

/// `PATCH /users/:id/password` (admin) — pengganti aksi `resetPassword` Edge
/// Function `admin-users`.
final resetPasswordCallerProvider =
    Provider<Future<void> Function(String userId, String password)>((ref) {
  return (userId, password) async {
    await const ApiClient().patch('/users/$userId/password', body: {'newPassword': password});
  };
});
