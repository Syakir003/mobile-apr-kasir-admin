// Timestamp tiba sebagai string ISO-8601 (REST/Socket.IO Nest: `createdAt`).
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

  bool get isJob =>
      type == 'job_assigned' || type == 'service_priced' || type == 'findings_sent';
  bool get isRequest =>
      type == 'request_submitted' || type == 'request_decided';

  /// Halaman yang dibuka saat notifikasi diketuk (cerminan `notificationHref` di notification-bell.tsx web). null =
  /// tidak ada tujuan. [target] berisi id job, atau id pelanggan untuk `service_due` dan `unit_data_completed`.
  String? get route => switch (type) {
        'job_review' ||
        'job_assigned' ||
        'job_returned' ||
        'job_cancelled' ||
        'findings_sent' ||
        'service_priced' ||
        'unit_added' =>
          target != null ? '/jobs/$target' : '/jobs',
        'request_submitted' => '/pengajuan',
        // Job sudah dialihkan dari teknisi ini (bukan miliknya lagi), jadi buka antrian.
        'request_decided' || 'job_handover' => '/jobs',
        'penjualan_baru' => '/keluar-gudang',
        'stok_menipis' => '/spareparts',
        'opname_selesai' => '/stok/opname',
        'unit_correction' => '/koreksi-unit',
        'service_due' => '/orders/new',
        'unit_data_completed' => target != null ? '/pengingat/jadwal/$target' : '/pengingat/jadwal',
        _ => null,
      };

  /// Isian otomatis form Terima Servis untuk `service_due`: pelanggan terpilih dan unit yang jatuh tempo tercentang.
  Object? get routeExtra =>
      type == 'service_due' && target != null ? {'memberId': target, 'dueOnly': true} : null;

  factory AppNotification.fromMap(String id, Map<String, dynamic> data) =>
      AppNotification(
        id: id,
        title: (data['title'] as String?) ?? '',
        body: (data['body'] as String?) ?? '',
        type: (data['type'] as String?) ?? 'info',
        target: data['target'] as String?,
        read: (data['read'] as bool?) ?? false,
        createdAt: _toDate(data['created_at'] ?? data['createdAt']),
      );
}
