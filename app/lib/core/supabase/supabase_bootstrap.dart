import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Anon key default Supabase LOKAL (`supabase start`). Ini demo key publik
/// yang sama untuk semua instalasi CLI — aman di-commit, hanya berlaku untuk
/// stack lokal. Produksi WAJIB override lewat --dart-define.
const _localAnonKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'
    'eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.'
    'CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const _envUrl = String.fromEnvironment('SUPABASE_URL');
const _envAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

/// Emulator Android mengakses host lewat 10.0.2.2, bukan localhost.
/// Perangkat fisik: pakai IP LAN mesin dev via --dart-define=SUPABASE_URL=...
String _defaultLocalUrl() {
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
    return 'http://10.0.2.2:54321';
  }
  return 'http://127.0.0.1:54321';
}

Future<void> bootstrapSupabase() async {
  await Supabase.initialize(
    url: _envUrl.isNotEmpty ? _envUrl : _defaultLocalUrl(),
    anonKey: _envAnonKey.isNotEmpty ? _envAnonKey : _localAnonKey,
  );
}
