import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../router/app_router.dart';

/// Buka stream data hanya SETELAH sesi login siap.
///
/// Kenapa ada: `.stream()` / `.select()` yang dijalankan sebelum token sesi
/// terpasang pada client Supabase berangkat sebagai peran `anon`. `anon` sengaja
/// tidak diberi GRANT apa pun (migrasi 0006), jadi PostgREST membalas
/// **"permission denied for table …"** — bukan daftar kosong, melainkan error.
///
/// Gejalanya khas dan sempat lolos dari seluruh test: tepat setelah LOGIN
/// pertama, layar Riwayat menampilkan "Gagal memuat data — permission denied
/// for table invoices". Reload halaman membuatnya normal, karena saat itu sesi
/// sudah ada sebelum layar dibangun. Test widget tidak pernah menangkapnya
/// (repository selalu di-override fake, tak ada sesi sungguhan yang dinanti).
///
/// Error itu juga **lengket**: provider daftar utama sengaja bukan
/// `autoDispose` supaya cache-nya awet, sehingga stream yang gagal sekali
/// bertahan seumur sesi aplikasi. Dengan menonton [currentUserProvider], stream
/// dibangun ulang begitu sesi berubah — sekaligus menutup stream saat logout,
/// jadi data pengguna lama tidak tertinggal di memori untuk pengguna berikutnya.
Stream<T> streamWhenSignedIn<T>(Ref ref, Stream<T> Function() open) {
  final auth = ref.watch(currentUserProvider);
  // Selama sesi belum jelas (loading) atau kosong (logout), jangan menyentuh
  // jaringan sama sekali; consumer cukup melihat status loading.
  if (auth.value == null) return Stream<T>.empty();
  return open();
}
