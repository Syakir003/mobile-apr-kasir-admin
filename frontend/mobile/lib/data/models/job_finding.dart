import 'job_photo.dart' show PhotoKind;

/// Foto sebelum/sesudah yang melekat ke satu temuan (`job_finding_photos`).
class JobFindingPhoto {
  const JobFindingPhoto({required this.id, required this.kind, required this.path});

  final String id;
  final PhotoKind kind;

  /// Path file di server (`/uploads/job-photos/...`), diubah jadi URL lewat `/uploads/sign`.
  final String path;

  factory JobFindingPhoto.fromNest(Map<String, dynamic> j) => JobFindingPhoto(
        id: '${j['id']}',
        kind: PhotoKind.fromValue(j['kind']),
        path: (j['path'] as String?) ?? '',
      );
}

/// Temuan masalah pada satu job (`job_findings`): judul kategori + catatan +
/// foto bukti. Job baru bisa diajukan selesai bila SETIAP temuan punya foto
/// sebelum dan sesudah.
class JobFinding {
  const JobFinding({
    required this.id,
    required this.title,
    this.note,
    this.photos = const [],
  });

  final String id;
  final String title;
  final String? note;
  final List<JobFindingPhoto> photos;

  bool get hasBefore => photos.any((p) => p.kind == PhotoKind.sebelum);
  bool get hasAfter => photos.any((p) => p.kind == PhotoKind.sesudah);

  factory JobFinding.fromNest(Map<String, dynamic> j) => JobFinding(
        id: '${j['id']}',
        title: (j['title'] as String?) ?? '',
        note: j['note'] as String?,
        photos: [
          for (final p in (j['photos'] as List? ?? const []))
            JobFindingPhoto.fromNest(Map<String, dynamic>.from(p as Map)),
        ],
      );
}
