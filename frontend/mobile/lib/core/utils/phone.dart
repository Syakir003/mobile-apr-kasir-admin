/// Normalisasi nomor telepon Indonesia ke bentuk `+628xxxxxxxx`.
///
/// Spasi, strip, titik, dan kurung dibuang. Awalan `08x`/`628x`/`8x`
/// dikonversi ke `+628x`; nomor yang sudah `+62` dibiarkan. Selain pola
/// tersebut (mis. telepon rumah `021...` atau nomor asing) dikembalikan
/// apa adanya setelah dibersihkan.
String normalizePhone(String raw) {
  final cleaned = raw.replaceAll(RegExp(r'[\s\-.()]'), '');
  if (cleaned.startsWith('+62')) return cleaned;
  if (cleaned.startsWith('628')) return '+$cleaned';
  if (cleaned.startsWith('08')) return '+62${cleaned.substring(1)}';
  if (cleaned.startsWith('8')) return '+62$cleaned';
  return cleaned;
}
