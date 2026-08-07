import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/widgets.dart' as pw;

/// Tema dokumen PDF dengan font ber-Unicode.
///
/// `pdf` memakai Helvetica bawaan PDF bila tidak diberi font; font itu tidak
/// punya tabel Unicode, jadi setiap karakter di luar ASCII (`•`, `—`, `×`,
/// huruf beraksen pada nama pelanggan) hilang dari cetakan — dan paketnya hanya
/// mengeluh lewat log `Helvetica has no Unicode support`. Roboto dibundel di
/// `assets/fonts/` supaya struk tetap benar tanpa koneksi internet.
///
/// Hasilnya di-cache: tiap TTF ~165 KB dan struk bisa dicetak berkali-kali.
pw.ThemeData? _cached;

Future<pw.ThemeData> pdfTheme() async {
  final cached = _cached;
  if (cached != null) return cached;

  final regular = pw.Font.ttf(
      await rootBundle.load('assets/fonts/roboto-regular.ttf'));
  final bold =
      pw.Font.ttf(await rootBundle.load('assets/fonts/roboto-bold.ttf'));

  // `italic`/`boldItalic` sengaja memakai varian tegak: dokumen di aplikasi ini
  // tidak memakai miring, jadi tak perlu menambah 330 KB aset lagi.
  final theme = pw.ThemeData.withFont(
    base: regular,
    bold: bold,
    italic: regular,
    boldItalic: bold,
  );
  _cached = theme;
  return theme;
}

/// Logo perusahaan untuk kop dokumen cetak.
///
/// Di-cache dengan alasan yang sama seperti [pdfTheme]: berkasnya ~30 KB dan
/// struk dicetak berkali-kali dalam satu sesi kasir.
pw.MemoryImage? _cachedLogo;

Future<pw.MemoryImage> pdfLogo() async {
  final cached = _cachedLogo;
  if (cached != null) return cached;

  final data = await rootBundle.load('assets/brand/logo-apr-trim.png');
  final logo = pw.MemoryImage(data.buffer.asUint8List());
  _cachedLogo = logo;
  return logo;
}
