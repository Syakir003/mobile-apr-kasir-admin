import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/session_gate.dart';
import '../../core/supabase/supabase_providers.dart';
import '../../core/utils/error_message.dart';
import '../../data/models/managed_user.dart';

/// Seluruh akun (admin saja — RLS `users` mengizinkan admin/kasir membaca
/// semua baris, dan rute '/users' dikunci admin di redirect.dart).
/// Realtime: tabel `users` sudah terdaftar di publication supabase_realtime.
final managedUsersProvider = StreamProvider<List<ManagedUser>>((ref) {
  return streamWhenSignedIn(ref, () => ref
      .watch(supabaseProvider)
      .from('users')
      .stream(primaryKey: ['id'])
      .order('created_at')
      .map((rows) => rows
          .map((row) => ManagedUser.fromMap(row['id'] as String, row))
          .toList(growable: false)));
});

/// RPC `update_user_account` — ubah peran / status aktif / nama tampilan.
/// Penjaga "minimal satu Admin aktif" & "tak bisa menurunkan diri sendiri"
/// ada di backend; UI hanya meneruskan pesan errornya.
final updateUserAccountCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    await ref
        .read(supabaseProvider)
        .rpc('update_user_account', params: {'payload': payload});
  };
});

/// Edge Function `admin-users` aksi `create` — membuat akun baru.
/// Tidak bisa lewat RPC: menulis ke skema `auth` butuh service_role yang
/// sengaja tidak pernah ada di dalam aplikasi.
final createUserAccountCallerProvider =
    Provider<Future<void> Function(Map<String, dynamic> body)>((ref) {
  return (body) async {
    final client = ref.read(supabaseProvider);
    try {
      await client.functions.invoke(
        'admin-users',
        body: {'action': 'create', ...body},
      );
    } catch (e) {
      throw Exception(errorMessage(e));
    }
  };
});

/// Edge Function `admin-users` aksi `resetPassword`.
final resetPasswordCallerProvider =
    Provider<Future<void> Function(String userId, String password)>((ref) {
  return (userId, password) async {
    final client = ref.read(supabaseProvider);
    try {
      await client.functions.invoke(
        'admin-users',
        body: {
          'action': 'resetPassword',
          'userId': userId,
          'password': password,
        },
      );
    } catch (e) {
      throw Exception(errorMessage(e));
    }
  };
});
