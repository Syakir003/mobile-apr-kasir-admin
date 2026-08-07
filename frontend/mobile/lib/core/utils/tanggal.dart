/// Nama hari & bulan bahasa Indonesia.
///
/// Ditulis manual alih-alih memakai `intl` dengan locale `id_ID` karena
/// paket itu butuh inisialisasi data locale saat start-up, sementara yang
/// dibutuhkan aplikasi cuma dua tabel nama di bawah ini.
const _hari = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
  'Minggu',
];

const _bulan = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/// `Rabu, 22 Juli 2026` — dipakai pada sub-judul header halaman.
String formatTanggalPanjang(DateTime d) =>
    '${_hari[d.weekday - 1]}, ${d.day} ${_bulan[d.month - 1]} ${d.year}';

/// `Sen`, `Sel`, … — label sumbu grafik harian.
String singkatanHari(DateTime d) => _hari[d.weekday - 1].substring(0, 3);
