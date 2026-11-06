/// Mengubah exception apa pun menjadi kalimat yang layak dibaca pengguna.
///
/// Error backend Nest sudah berupa pesan bahasa Indonesia (`NestApiException`,
/// `toString()` = pesannya); di sini cukup mengupas awalan "Exception: " milik
/// exception Dart biasa.
String errorMessage(Object error) {
  final cleaned = '$error'.replaceFirst(RegExp(r'^Exception:\s*'), '').trim();
  return cleaned.isEmpty ? 'Terjadi kesalahan. Coba lagi.' : cleaned;
}
