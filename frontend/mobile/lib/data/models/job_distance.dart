/// Jarak job ke toko dari `POST /technician-jobs/distances` (urutan "Terdekat dari Toko" di Antrian Servis).
/// Cerminan tipe `JobDistance` di web (queue-client.tsx). Hasil dihitung bertahap di server: job yang belum sempat
/// dihitung berstatus [DistanceState.pending] dan perlu ditanyakan lagi.
enum DistanceState { ok, unknown, pending }

/// Kenapa jarak tidak diketahui (hanya untuk [DistanceState.unknown]).
enum DistanceReason {
  noAddress('Tanpa alamat'),
  incomplete('Alamat kurang lengkap (tulis kabupaten/kota)'),
  notFound('Alamat tidak ditemukan'),
  serviceError('Gagal dicari (layanan peta menolak)');

  const DistanceReason(this.label);
  final String label;

  static DistanceReason parse(Object? v) => switch (v) {
        'no_address' => noAddress,
        'incomplete' => incomplete,
        'service_error' => serviceError,
        _ => notFound,
      };
}

/// Ketelitian titik (dari yang terbaik): titik Maps > jalan > desa > kecamatan > perkiraan > pusat wilayah.
enum DistancePrecision {
  titik('titik pasti'),
  jalan('sampai jalan'),
  desa('level desa'),
  kecamatan('level kecamatan'),
  perkiraan('perkiraan daerah'),
  wilayah('pusat kota/kabupaten');

  const DistancePrecision(this.label);
  final String label;

  static DistancePrecision? parse(Object? v) => switch (v) {
        'titik' => titik,
        'jalan' => jalan,
        'desa' => desa,
        'kecamatan' => kecamatan,
        'perkiraan' => perkiraan,
        'wilayah' => wilayah,
        _ => null,
      };
}

class JobDistance {
  const JobDistance({required this.jobId, required this.state, this.km, this.reason, this.precision});

  final String jobId;
  final DistanceState state;

  /// Garis lurus dari toko (km, 1 desimal); null bila belum/tidak diketahui.
  final double? km;
  final DistanceReason? reason;
  final DistancePrecision? precision;

  factory JobDistance.fromJson(Map<String, dynamic> j) => JobDistance(
        jobId: '${j['jobId']}',
        state: switch (j['state']) {
          'ok' => DistanceState.ok,
          'pending' => DistanceState.pending,
          _ => DistanceState.unknown,
        },
        km: (j['km'] as num?)?.toDouble(),
        reason: j['reason'] == null ? null : DistanceReason.parse(j['reason']),
        precision: DistancePrecision.parse(j['precision']),
      );
}

/// Satu respons `/technician-jobs/distances`. [pending] > 0 = masih ada alamat yang dihitung di server.
class JobDistancesResult {
  const JobDistancesResult({required this.items, required this.pending});

  final List<JobDistance> items;
  final int pending;

  factory JobDistancesResult.fromJson(Map<String, dynamic> j) => JobDistancesResult(
        items: [
          for (final i in (j['items'] as List? ?? const [])) JobDistance.fromJson(Map<String, dynamic>.from(i as Map)),
        ],
        pending: (j['pending'] as num?)?.toInt() ?? 0,
      );
}
