import 'package:supabase_flutter/supabase_flutter.dart';

// =============================================================================
// Default = Supabase CLOUD (proyek "Syakir003's Project", ref
// xmzrzcgllztwikzdxfrt). Jadi `flutter build apk` TANPA flag apa pun sudah
// menunjuk ke internet — user tinggal install ulang lalu langsung login.
//
// DEV LOKAL (`supabase start`): launch.json mengoper
// `--dart-define=SUPABASE_URL=http://<ip-lan-atau-10.0.2.2>:54321`. Saat URL
// dioper tapi anon key tidak, dipakai anon key lokal bawaan CLI di bawah.
//
// anon/publishable key aman ikut di binary (dilindungi RLS). JANGAN pernah
// menaruh service_role / sb_secret_ di sini.
// =============================================================================
const _cloudUrl = 'https://xmzrzcgllztwikzdxfrt.supabase.co';
const _cloudAnonKey = 'sb_publishable_dllz3GzIojNSwYEd0BFZiw_4jCXvo2P';

/// Publishable key default Supabase LOKAL (`supabase start`) — demo key publik
/// CLI, sama untuk semua instalasi, hanya berlaku untuk stack lokal.
const _localAnonKey = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

const _envUrl = String.fromEnvironment('SUPABASE_URL');
const _envAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

Future<void> bootstrapSupabase() async {
  final url = _envUrl.isNotEmpty ? _envUrl : _cloudUrl;
  final key = _envAnonKey.isNotEmpty
      ? _envAnonKey
      // URL dioper (dev lokal) tapi anon key tidak → pakai key lokal CLI.
      : (_envUrl.isEmpty ? _cloudAnonKey : _localAnonKey);
  await Supabase.initialize(url: url, publishableKey: key);
}
