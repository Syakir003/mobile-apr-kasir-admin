// Kolom timestamptz Postgres tiba sebagai string ISO-8601 lewat PostgREST.
DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

/// Satu notifikasi in-app (tabel `notifications`). [target] menyimpan id entitas
/// terkait (mis. jobId) untuk deep-link.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.type,
    required this.read,
    this.target,
    this.createdAt,
  });

  final String id;
  final String title;
  final String body;
  final String type;
  final String? target;
  final bool read;
  final DateTime? createdAt;

  bool get isJob => type == 'job_assigned';
  bool get isRequest =>
      type == 'request_submitted' || type == 'request_decided';

  factory AppNotification.fromMap(String id, Map<String, dynamic> data) =>
      AppNotification(
        id: id,
        title: (data['title'] as String?) ?? '',
        body: (data['body'] as String?) ?? '',
        type: (data['type'] as String?) ?? 'info',
        target: data['target'] as String?,
        read: (data['read'] as bool?) ?? false,
        createdAt: _toDate(data['created_at']),
      );
}
