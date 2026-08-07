/// Format rupiah sederhana tanpa dependensi `intl`: pemisah ribuan titik.
/// Contoh: `104900` -> `'Rp 104.900'`.
///
/// Satu-satunya sumber format uang di aplikasi. Sebelumnya beberapa layar
/// master menulis `'Rp ${p.sellPrice}'` langsung sehingga tampil `Rp 5500000`
/// sementara POS menampilkan `Rp 5.500.000` untuk angka yang sama.
String formatRupiah(int value) {
  final negative = value < 0;
  final digits = value.abs().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return 'Rp ${negative ? '-' : ''}$buffer';
}

/// Varian untuk nilai yang bisa pecahan (mis. harga dari kolom `numeric`).
/// Pecahan dibulatkan karena rupiah tidak memakai sen.
String formatRupiahNum(num value) => formatRupiah(value.round());

/// Bentuk ringkas untuk kotak statistik yang lebarnya sempit:
/// `1500` -> `'Rp 1.500'`, `1500000` -> `'Rp 1,5 jt'`, `2000000000` -> `'Rp 2 M'`.
///
/// Di bawah satu juta tetap memakai [formatRupiah] penuh — angka segitu masih
/// muat dan pembulatan justru menyembunyikan selisih yang berarti.
String formatRupiahShort(int value) {
  final negative = value < 0;
  final v = value.abs();
  if (v < 1000000) return formatRupiah(value);

  final (double scaled, String suffix) =
      v >= 1000000000 ? (v / 1000000000, 'M') : (v / 1000000, 'jt');
  // Satu desimal, dan `,0` dibuang supaya "Rp 2 jt" tidak jadi "Rp 2,0 jt".
  final text = scaled.toStringAsFixed(1).replaceAll('.', ',');
  final trimmed = text.endsWith(',0') ? text.substring(0, text.length - 2) : text;
  return 'Rp ${negative ? '-' : ''}$trimmed $suffix';
}
