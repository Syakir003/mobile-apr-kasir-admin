/// Jenis foto bukti pengerjaan job teknisi.
enum PhotoKind {
  sebelum('sebelum', 'Sebelum'),
  sesudah('sesudah', 'Sesudah');

  const PhotoKind(this.value, this.label);

  final String value;
  final String label;

  static PhotoKind fromValue(Object? value) => values.firstWhere(
        (k) => k.value == value,
        orElse: () => PhotoKind.sebelum,
      );
}

// Kolom timestamptz Postgres tiba sebagai string ISO-8601 lewat PostgREST.
DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

/// Susun object path dalam bucket `job-photos`: `<jobId>/<kind>/<ms>.<ext>`.
/// Murni (tanpa efek samping) agar mudah diuji; pemanggil menyediakan timestamp.
String buildJobPhotoPath(
  String jobId,
  PhotoKind kind,
  int timestampMs,
  String ext,
) {
  final safeExt = ext.replaceAll(RegExp(r'[^a-zA-Z0-9]'), '').toLowerCase();
  return '$jobId/${kind.value}/$timestampMs.${safeExt.isEmpty ? 'jpg' : safeExt}';
}

/// Metadata satu foto bukti (tabel `job_photos`). File biner ada di Storage;
/// [path] adalah object path untuk membuat signed URL.
class JobPhoto {
  const JobPhoto({
    required this.id,
    required this.jobId,
    required this.kind,
    required this.path,
    this.createdAt,
  });

  final String id;
  final String jobId;
  final PhotoKind kind;
  final String path;
  final DateTime? createdAt;

  factory JobPhoto.fromMap(String id, Map<String, dynamic> data) => JobPhoto(
        id: id,
        jobId: (data['job_id'] as String?) ?? '',
        kind: PhotoKind.fromValue(data['kind']),
        path: (data['path'] as String?) ?? '',
        createdAt: _toDate(data['created_at']),
      );
}
