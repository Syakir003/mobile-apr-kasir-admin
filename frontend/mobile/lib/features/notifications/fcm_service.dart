import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../firebase_options.dart';

/// Integrasi FCM: inisialisasi Firebase, minta izin, ambil token, dan daftarkan
/// ke Supabase (`register_device_token`). Semua langkah di-guard — bila Firebase
/// belum dikonfigurasi (`flutterfire configure` belum dijalankan) atau izin
/// ditolak, push nonaktif diam-diam dan notifikasi in-app tetap berjalan.
///
/// Web: `getToken` butuh VAPID key — set lewat --dart-define=FCM_VAPID_KEY=...
class FcmService {
  FcmService(this._client);

  final SupabaseClient _client;
  bool _initialized = false;
  String? _token;

  static const _vapidKey = String.fromEnvironment('FCM_VAPID_KEY');

  String get _platform => kIsWeb ? 'web' : defaultTargetPlatform.name;

  /// Dipanggil saat user login. Idempoten.
  Future<void> start() async {
    if (_initialized) {
      // Sudah init sebelumnya (mis. ganti user) → cukup daftar ulang token.
      if (_token != null) await _register(_token!);
      return;
    }

    try {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
    } catch (e) {
      debugPrint('FCM: Firebase belum dikonfigurasi, push nonaktif ($e)');
      return;
    }
    _initialized = true;

    try {
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        debugPrint('FCM: izin notifikasi ditolak');
        return;
      }

      _token = await messaging.getToken(
        vapidKey: _vapidKey.isEmpty ? null : _vapidKey,
      );
      if (_token != null) await _register(_token!);

      messaging.onTokenRefresh.listen((t) {
        _token = t;
        _register(t);
      });
    } catch (e) {
      debugPrint('FCM: gagal ambil/registrasi token ($e)');
    }
  }

  Future<void> _register(String token) async {
    try {
      await _client.rpc('register_device_token', params: {
        'payload': {'token': token, 'platform': _platform},
      });
    } catch (e) {
      debugPrint('FCM: register_device_token gagal ($e)');
    }
  }

  /// Dipanggil saat logout agar user berikutnya di HP ini tak menerima push.
  Future<void> stop() async {
    final token = _token;
    if (token == null) return;
    try {
      await _client.rpc('unregister_device_token', params: {
        'payload': {'token': token},
      });
    } catch (e) {
      debugPrint('FCM: unregister gagal ($e)');
    }
  }
}

final fcmServiceProvider = Provider<FcmService>(
  (ref) => FcmService(ref.watch(supabaseProvider)),
);
