// PLACEHOLDER — file ini akan DITIMPA oleh `flutterfire configure`.
//
// Sebelum dikonfigurasi, [currentPlatform] sengaja melempar error; FcmService
// menangkapnya dan menonaktifkan push dengan aman (notifikasi in-app tetap
// jalan). Setelah `flutterfire configure`, isi asli menggantikan file ini.
import 'package:firebase_core/firebase_core.dart';

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    throw UnsupportedError(
      'firebase_options.dart belum dikonfigurasi. '
      'Jalankan `flutterfire configure` untuk mengaktifkan FCM.',
    );
  }
}
