/// Data pelengkap satu entri riwayat pekerjaan.
///
/// Dipisah dari [TechnicianJob] karena sumbernya tabel lain (`job_photos`,
/// `material_requests`) dan hanya dibutuhkan layar riwayat — daftar job biasa
/// tidak perlu ikut menanggung dua query tambahan.
///
/// Catatan RLS: sejak migrasi 0020 teknisi hanya melihat pengajuan material
/// pada job MILIKNYA. Untuk job teknisi lain pada unit yang sama, angka
/// material wajar bernilai 0 — dan dari sisi client itu tak bisa dibedakan
/// dari "memang tidak ada". Karena itu UI menyembunyikan baris material saat
/// nol alih-alih menuliskan "tanpa material".
class JobHistoryExtra {
  const JobHistoryExtra({
    this.photosBefore = 0,
    this.photosAfter = 0,
    this.materialItems = 0,
    this.materialTotal = 0,
    this.materialPending = 0,
  });

  /// Jumlah foto bukti sebelum & sesudah pengerjaan.
  final int photosBefore;
  final int photosAfter;

  /// Pengajuan material yang DISETUJUI: banyaknya pengajuan & nilai rupiahnya.
  final int materialItems;
  final int materialTotal;

  /// Pengajuan yang masih menunggu keputusan.
  final int materialPending;

  int get photoCount => photosBefore + photosAfter;
  bool get hasPhotos => photoCount > 0;
  bool get hasMaterial => materialItems > 0 || materialPending > 0;

  /// Foto bukti lengkap = ada minimal satu sebelum DAN satu sesudah. Rule 8.4
  /// mewajibkan keduanya sebelum job boleh diselesaikan.
  bool get photosComplete => photosBefore > 0 && photosAfter > 0;

  static const empty = JobHistoryExtra();
}
