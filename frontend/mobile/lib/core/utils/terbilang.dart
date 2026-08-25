const _satuan = [
  'nol',
  'satu',
  'dua',
  'tiga',
  'empat',
  'lima',
  'enam',
  'tujuh',
  'delapan',
  'sembilan',
  'sepuluh',
  'sebelas',
];

String _kata(int n) {
  if (n < 12) return _satuan[n];
  if (n < 20) return '${_kata(n - 10)} belas';
  if (n < 100) {
    final sisa = n % 10;
    return '${_kata(n ~/ 10)} puluh${sisa == 0 ? '' : ' ${_kata(sisa)}'}';
  }
  if (n < 200) {
    final sisa = n - 100;
    return 'seratus${sisa == 0 ? '' : ' ${_kata(sisa)}'}';
  }
  if (n < 1000) {
    final sisa = n % 100;
    return '${_kata(n ~/ 100)} ratus${sisa == 0 ? '' : ' ${_kata(sisa)}'}';
  }
  if (n < 2000) {
    final sisa = n - 1000;
    return 'seribu${sisa == 0 ? '' : ' ${_kata(sisa)}'}';
  }
  if (n < 1000000) {
    final sisa = n % 1000;
    return '${_kata(n ~/ 1000)} ribu${sisa == 0 ? '' : ' ${_kata(sisa)}'}';
  }
  if (n < 1000000000) {
    final sisa = n % 1000000;
    return '${_kata(n ~/ 1000000)} juta${sisa == 0 ? '' : ' ${_kata(sisa)}'}';
  }
  if (n < 1000000000000) {
    final sisa = n % 1000000000;
    return '${_kata(n ~/ 1000000000)} miliar${sisa == 0 ? '' : ' ${_kata(sisa)}'}';
  }
  final sisa = n % 1000000000000;
  return '${_kata(n ~/ 1000000000000)} triliun${sisa == 0 ? '' : ' ${_kata(sisa)}'}';
}

/// Angka rupiah -> kata Bahasa Indonesia, buat baris "Terbilang" di invoice.
/// `104900` -> `'Seratus empat ribu sembilan ratus rupiah'`.
String terbilangRupiah(int value) {
  if (value == 0) return 'Nol rupiah';
  final kata = _kata(value.abs());
  final kalimat = '${kata[0].toUpperCase()}${kata.substring(1)} rupiah';
  return value < 0 ? 'Minus $kalimat' : kalimat;
}
