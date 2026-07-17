/// Status job teknisi (disimpan sebagai text snake_case di Postgres).
enum JobStatus {
  menungguPenugasan('menunggu_penugasan', 'Menunggu Penugasan'),
  assigned('assigned', 'Ditugaskan'),
  sedangDikerjakan('sedang_dikerjakan', 'Sedang Dikerjakan'),
  selesai('selesai', 'Selesai'),
  dibatalkan('dibatalkan', 'Dibatalkan');

  const JobStatus(this.value, this.label);

  final String value;
  final String label;

  /// Nilai tak dikenal jatuh ke [menungguPenugasan] (default saat dibuat
  /// tanpa teknisi).
  static JobStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => JobStatus.menungguPenugasan,
      );

  bool get isActive =>
      this == assigned || this == sedangDikerjakan || this == menungguPenugasan;
}

/// Jenis pekerjaan. Nilai bebas (checkout hanya membuat 'pemasangan'); label
/// Indonesia dipetakan untuk yang dikenal, sisanya ditampilkan apa adanya.
String jobTypeLabel(String type) => switch (type) {
      'pemasangan' => 'Pemasangan',
      'cuci' => 'Cuci AC',
      'service' => 'Service',
      'maintenance' => 'Maintenance',
      'bongkar' => 'Bongkar',
      'bongkar_pasang' => 'Bongkar Pasang',
      _ => type.isEmpty ? 'Pekerjaan' : type,
    };

// Kolom timestamptz Postgres tiba sebagai string ISO-8601 lewat PostgREST.
DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

/// Job teknisi (tabel `technician_jobs`), diperkaya dengan data member, unit
/// AC, dan nama teknisi lewat repositori (join client-side). Field enrichment
/// bersifat opsional — kosong bila relasi belum dimuat.
class TechnicianJob {
  const TechnicianJob({
    required this.id,
    required this.orderId,
    required this.memberId,
    required this.unitId,
    required this.technicianId,
    required this.type,
    required this.status,
    this.scheduledDate,
    this.notes,
    this.startedAt,
    this.completedAt,
    this.createdAt,
    this.memberName = '',
    this.memberPhone = '',
    this.memberAddress = '',
    this.unitBrand = '',
    this.unitModel = '',
    this.unitPk = 0,
    this.unitRoom = '',
    this.unitBarcode = '',
    this.technicianName = '',
  });

  final String id;
  final String orderId;
  final String memberId;
  final String? unitId;
  final String? technicianId;
  final String type;
  final JobStatus status;
  final DateTime? scheduledDate;
  final String? notes;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final DateTime? createdAt;

  // Enrichment (join client-side).
  final String memberName;
  final String memberPhone;
  final String memberAddress;
  final String unitBrand;
  final String unitModel;
  final double unitPk;
  final String unitRoom;
  final String unitBarcode;
  final String technicianName;

  String get typeLabel => jobTypeLabel(type);
  String get unitTitle => '$unitBrand $unitModel'.trim();

  /// [data] adalah baris `technician_jobs`; relasi bisa disuntik repositori
  /// lewat key opsional 'member', 'unit', dan 'technician_name'.
  factory TechnicianJob.fromMap(String id, Map<String, dynamic> data) {
    final member = data['member'] as Map<String, dynamic>?;
    final unit = data['unit'] as Map<String, dynamic>?;
    return TechnicianJob(
      id: id,
      orderId: (data['order_id'] as String?) ?? '',
      memberId: (data['member_id'] as String?) ?? '',
      unitId: data['unit_id'] as String?,
      technicianId: data['technician_id'] as String?,
      type: (data['type'] as String?) ?? 'pemasangan',
      status: JobStatus.fromValue(data['status']),
      scheduledDate: _toDate(data['scheduled_date']),
      notes: data['notes'] as String?,
      startedAt: _toDate(data['started_at']),
      completedAt: _toDate(data['completed_at']),
      createdAt: _toDate(data['created_at']),
      memberName: (member?['name'] as String?) ?? '',
      memberPhone: (member?['phone'] as String?) ?? '',
      memberAddress: (member?['address'] as String?) ?? '',
      unitBrand: (unit?['brand'] as String?) ?? '',
      unitModel: (unit?['model'] as String?) ?? '',
      unitPk: (unit?['pk'] as num?)?.toDouble() ?? 0,
      unitRoom: (unit?['room_location'] as String?) ?? '',
      unitBarcode: (unit?['barcode_value'] as String?) ?? '',
      technicianName: (data['technician_name'] as String?) ?? '',
    );
  }
}
