// Aturan penulisan alamat. Cerminan web: Nest/epos-frontend-web/src/lib/address-check.ts (dan backend geo.util.ts:
// buildGeocodePlan) — ubah ketiganya bersamaan.
//
// Format: <jalan/perumahan> No. X, <desa/kelurahan>, <kecamatan>, Kabupaten|Kota <nama>
// Kabupaten/kota WAJIB: tanpa itu peta bisa meleset ke daerah lain bernama sama sehingga jarak "Terdekat dari Toko" salah.
// Link Google Maps sungguhan mengalahkan aturan ini (titiknya sudah pasti).

const addressExample = 'Jl. Airlangga No. 55, Mojosari, Kabupaten Mojokerto';

const _knownRegions = {
  'bangkalan', 'banyuwangi', 'batu', 'blitar', 'bojonegoro', 'bondowoso', 'gresik', 'jember', 'jombang', 'kediri',
  'lamongan', 'lumajang', 'madiun', 'magetan', 'malang', 'mojokerto', 'nganjuk', 'ngawi', 'pacitan', 'pamekasan',
  'pasuruan', 'ponorogo', 'probolinggo', 'sampang', 'sidoarjo', 'situbondo', 'sumenep', 'surabaya', 'trenggalek',
  'tuban', 'tulungagung', //
};

class AddressCheck {
  const AddressCheck({this.blocking, this.warnings = const []});

  /// Pesan bila alamat TIDAK boleh disimpan (tanpa kabupaten/kota). null = boleh.
  final String? blocking;

  /// Saran yang tidak menghalangi.
  final List<String> warnings;
}

/// Isian link Maps yang berupa link sungguhan (bukan ketikan biasa nama daerah).
bool isMapsLink(String? v) => RegExp(r'^https?://\S+$', caseSensitive: false).hasMatch((v ?? '').trim());

/// Singkatan yang tidak dikenali peta diperluas ("Kab." -> "Kabupaten"). Dipakai juga saat mengirim ke server.
String fixAddress(String text) => text
    .trim()
    .replaceAll(RegExp(r'\bkab\b\.?\s*', caseSensitive: false), 'Kabupaten ')
    .replaceAll(RegExp(r'\bkodya\b\.?\s*', caseSensitive: false), 'Kota ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

// Bagian yang diabaikan di mana pun posisinya: keterangan dalam kurung, provinsi, dan kode pos.
String _stripIgnorable(String t) => t
    .replaceAll(RegExp(r'\([^)]*\)'), ' ')
    .replaceAll(RegExp(r'[()]'), ' ')
    .replaceAll(RegExp(r'\b(?:jawa timur|jatim|indonesia)\b\.?', caseSensitive: false), ' ')
    .replaceAll(RegExp(r'\b\d{5}\b'), ' ')
    .replaceAll(RegExp(r'\s+,'), ',')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim()
    .replaceAll(RegExp(r'[\s,]+$'), '');

/// Bagian alamat di luar kabupaten/kota, atau null bila kabupaten/kota tidak disebut.
String? _splitRegion(String fixed) {
  final t = _stripIgnorable(fixed);
  final all = RegExp(r'\b(?:kota|kabupaten)\s+[a-z]+', caseSensitive: false).allMatches(t).toList();
  if (all.isNotEmpty) {
    final m = all.last;
    return '${t.substring(0, m.start)} ${t.substring(m.end)}';
  }
  // Tanpa kata kunci: hanya sah bila ber-koma dan bagian terakhir adalah nama kabupaten/kota yang dikenal.
  final parts = t.split(',').map((p) => p.trim()).where((p) => p.isNotEmpty).toList();
  if (parts.length >= 2 && _knownRegions.contains(parts.last.toLowerCase())) {
    return parts.sublist(0, parts.length - 1).join(', ');
  }
  return null;
}

// Huruf pada nama yang tersisa setelah RT/RW/No./Blok dan token berangka dibuang.
int _nameLetters(String s) => s
    .split(RegExp(r'[\s,]+'))
    .where((w) => w.isNotEmpty && !RegExp(r'\d').hasMatch(w) && !RegExp(r'^(?:rt|rw|no|nomor|blok|blk)\.?$', caseSensitive: false).hasMatch(w))
    .join()
    .replaceAll(RegExp(r'[^a-zA-Z]'), '')
    .length;

AddressCheck checkAddress(String? raw, {bool hasMapsLink = false}) {
  final text = (raw ?? '').trim();
  if (text.isEmpty || hasMapsLink) return const AddressCheck();

  final fixed = fixAddress(text);
  final warnings = <String>[
    if (fixed != text) 'Singkatan "Kab." akan ditulis menjadi "Kabupaten" (peta tidak mengenali singkatannya).',
    if (RegExp(r'\b[A-Za-z]*[a-z][A-Z][a-z]+\b').hasMatch(text))
      'Ada kata yang menempel (mis. "GebangMalang"). Pisahkan dengan spasi bila itu dua kata.',
    if (!text.contains(',') && text.length > 25)
      'Pisahkan bagian alamat dengan koma: jalan, desa, kecamatan, kabupaten/kota.',
  ];

  final rest = _splitRegion(fixed);
  if (rest == null) {
    return AddressCheck(blocking: 'Tulis kabupaten atau kotanya. Contoh: "$addressExample".', warnings: warnings);
  }
  if (_nameLetters(rest) < 3) {
    return AddressCheck(blocking: 'Tambahkan nama jalan, desa, atau kecamatan sebelum kabupaten/kota.', warnings: warnings);
  }
  return AddressCheck(warnings: warnings);
}

/// Pesan blokir untuk alamat yang akan disimpan, atau null bila boleh. Alamat yang TIDAK diubah dari [original]
/// (data lama) tidak diperiksa, dan alamat kosong dianggap boleh (kolom opsional).
String? addressBlocking(String? address, {String? original, bool hasMapsLink = false}) {
  final a = (address ?? '').trim();
  if (a.isEmpty || a == (original ?? '').trim()) return null;
  return checkAddress(a, hasMapsLink: hasMapsLink).blocking;
}
