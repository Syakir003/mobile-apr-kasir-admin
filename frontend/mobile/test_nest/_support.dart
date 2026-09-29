// Helper bersama test integrasi test_nest/ (backend Nest + DB lokal).
import 'dart:io';

import 'package:epos_ac/core/api/api_client.dart';
import 'package:epos_ac/core/auth/session_store.dart';
import 'package:epos_ac/data/repositories/auth_repository.dart';

const testPassword = String.fromEnvironment('TEST_PASSWORD', defaultValue: 'password123');
const testDb = String.fromEnvironment('TEST_DB', defaultValue: 'epos_db_vps');

/// Email per role dari --dart-define=ADMIN_EMAIL/KASIR_EMAIL/TEKNISI_EMAIL.
const _emails = {
  'admin': String.fromEnvironment('ADMIN_EMAIL'),
  'kasir': String.fromEnvironment('KASIR_EMAIL'),
  'teknisi': String.fromEnvironment('TEKNISI_EMAIL'),
};

String emailFor(String role) => _emails[role]!;

/// Login sebagai [role] ke backend sungguhan; SessionStore.instance diganti
/// in-memory supaya ApiClient pakai token ini.
Future<void> loginAs(String role) async {
  final session = SessionStore(MemoryKeyValueStore());
  SessionStore.instance = session;
  await NestAuthRepository(const ApiClient(), session)
      .signIn(email: _emails[role]!, password: testPassword);
}

/// Jalankan SQL ke DB lokal (container supabase_db_epos-ac) — dipakai buat
/// membandingkan hasil parser mobile dengan isi DB yang sebenarnya.
Future<String> sql(String query) async {
  final r = await Process.run('docker', [
    'exec', 'supabase_db_epos-ac', 'psql', '-U', 'postgres', '-d', testDb, '-tAc', query,
  ]);
  return (r.stdout as String).trim();
}
