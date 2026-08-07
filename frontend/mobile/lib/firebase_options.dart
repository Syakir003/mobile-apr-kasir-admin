// Konfigurasi Firebase proyek `ayub-podo-rukun`.
//
// Nilai di bawah disalin dari `android/app/google-services.json` (klien dengan
// package_name `com.ayubpodorukun.epos_ac`). Semuanya identifier publik yang
// memang ikut ter-embed di binary aplikasi — bukan rahasia. Yang rahasia adalah
// JSON service account untuk Edge Function `send-push`, dan itu tidak pernah
// masuk repo.
//
// Hanya Android yang didaftarkan. Platform lain sengaja melempar error;
// `FcmService` menangkapnya dan menonaktifkan push dengan aman (notifikasi
// in-app lewat Supabase Realtime tetap jalan).
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return android;
    }
    throw UnsupportedError(
      'Firebase belum dikonfigurasi untuk platform ini '
      '(${kIsWeb ? 'web' : defaultTargetPlatform.name}). '
      'Daftarkan app-nya di Firebase Console lalu tambahkan opsinya di sini.',
    );
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyCUEVph0W5v7fwaaB1nP4fqRBCNDm0ewUU',
    appId: '1:948610217072:android:e9c67e4356d0361c1ef0b5',
    messagingSenderId: '948610217072',
    projectId: 'ayub-podo-rukun',
    storageBucket: 'ayub-podo-rukun.firebasestorage.app',
  );
}
