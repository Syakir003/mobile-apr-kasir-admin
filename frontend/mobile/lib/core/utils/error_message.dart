import 'package:supabase_flutter/supabase_flutter.dart';

/// Mengubah exception apa pun menjadi kalimat yang layak dibaca pengguna.
///
/// Semua RPC melempar pesan berbahasa Indonesia lewat `raise exception`, tapi
/// PostgREST membungkusnya menjadi
/// `PostgrestException(message: Diskon melebihi subtotal, code: P0001,
/// details: Bad Request, hint: null)`. Pola lama `'$e'.replaceFirst('Exception: ','')`
/// tidak mengupas bungkus itu, sehingga seluruh baris teknis tadi bocor ke
/// snackbar. Helper ini mengambil `message`-nya saja.
String errorMessage(Object error) {
  final message = switch (error) {
    PostgrestException e => e.message,
    AuthException e => e.message,
    StorageException e => e.message,
    FunctionException e => _fromFunction(e),
    // Kegagalan langganan Realtime membawa dump parameter koneksi yang panjang
    // dan tak berguna bagi pengguna. Dicocokkan lewat nama tipe agar tidak
    // perlu mengimpor paket realtime secara langsung.
    _ when error.runtimeType.toString().contains('Realtime') =>
      'Koneksi realtime terputus. Tarik untuk memuat ulang.',
    _ => '$error',
  };

  // Exception Dart biasa masih membawa awalan "Exception: ".
  final cleaned = message.replaceFirst(RegExp(r'^Exception:\s*'), '').trim();
  return cleaned.isEmpty ? 'Terjadi kesalahan. Coba lagi.' : cleaned;
}

/// Edge Function mengembalikan body JSON `{ "error": "..." }`; tanpa ini
/// pengguna hanya melihat "FunctionException(status: 503)".
String _fromFunction(FunctionException e) {
  final details = e.details;
  if (details is Map && details['error'] != null) return '${details['error']}';
  if (details is String && details.trim().isNotEmpty) return details.trim();
  return switch (e.status) {
    // 503/404 di sini hampir selalu berarti fungsinya belum di-deploy.
    503 || 404 => 'Layanan ini belum aktif di server. '
        'Hubungi admin untuk men-deploy Edge Function.',
    401 || 403 => 'Anda tidak punya akses untuk tindakan ini.',
    _ => 'Gagal memproses (kode ${e.status}).',
  };
}
