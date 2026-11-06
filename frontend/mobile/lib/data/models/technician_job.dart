import '../../core/utils/num_parse.dart';
/// Status job teknisi (disimpan sebagai text snake_case di Postgres).
enum JobStatus {
  menungguPenugasan('menunggu_penugasan', 'Menunggu Penugasan'),
  assigned('assigned', 'Ditugaskan'),
  sedangDikerjakan('sedang_dikerjakan', 'Sedang Dikerjakan'),
  menungguReview('menunggu_review', 'Menunggu Review'),
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
      this == assigned ||
      this == sedangDikerjakan ||
      this == menungguReview ||
      this == menungguPenugasan;
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

/// Satu entri riwayat alih tugas (`job_handovers`).
class JobHandover {
  const JobHandover({
    required this.id,
    required this.createdAt,
    required this.statusAtHandover,
    required this.fromName,
    required this.toName,
    required this.handedByName,
    this.reason,
  });

  final String id;
  final DateTime? createdAt;
  final String statusAtHandover;
  final String fromName;
  final String toName;
  final String handedByName;
  final String? reason;

  /// Keterangan status job saat dialihkan (sama dengan `handoverStatusText` di web).
  String get statusText => switch (statusAtHandover) {
        'sedang_dikerjakan' => 'dialihkan saat sedang dikerjakan',
        'menunggu_review' => 'dialihkan saat menunggu review',
        _ => 'dialihkan sebelum dimulai',
      };

  factory JobHandover.fromNest(Map<String, dynamic> j) => JobHandover(
        id: '${j['id']}',
        createdAt: _toDate(j['createdAt']),
        statusAtHandover: (j['statusAtHandover'] as String?) ?? '',
        fromName: ((j['fromTechnician'] as Map?)?['displayName'] as String?) ?? '-',
        toName: ((j['toTechnician'] as Map?)?['displayName'] as String?) ?? '-',
        handedByName: ((j['handedBy'] as Map?)?['displayName'] as String?) ?? '-',
        reason: j['reason'] as String?,
      );
}

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
    this.reviewNote,
    this.findingsSentAt,
    this.priced = true,
    this.hasBeforePhoto,
    this.startedAt,
    this.completedAt,
    this.createdAt,
    this.memberName = '',
    this.memberPhone = '',
    this.memberAddress = '',
    this.memberMapsUrl = '',
    this.workAddress = '',
    this.workMapsUrl = '',
    this.unitBrand = '',
    this.unitModel = '',
    this.unitPk = 0,
    this.unitRoom = '',
    this.unitBarcode = '',
    this.unitParts = '',
    this.technicianName = '',
    this.siblingIds = const [],
    this.orderNote,
    this.technicianNote,
    this.handovers = const [],
    this.unitAwaitingData = false,
    this.findingHeads = const [],
    this.complaintOfJobId,
    this.complaintOfCompletedAt,
    this.complaintOfTechnicianName,
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

  /// Catatan admin saat mengembalikan job dari review (kosong bila tak pernah dikembalikan).
  final String? reviewNote;

  /// Kapan teknisi terakhir menekan Kirim Temuan (null = belum pernah).
  final DateTime? findingsSentAt;

  /// False bila order belum punya invoice: harga jasa belum ditetapkan kasir/admin,
  /// dan server menolak Ajukan Selesai. Default true (daftar job tak membawa data order).
  final bool priced;

  /// Hanya terisi dari `GET /technician-jobs/queue`: sudah ada foto sebelum di salah satu temuan?
  final bool? hasBeforePhoto;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final DateTime? createdAt;

  // Enrichment (join client-side).
  final String memberName;
  final String memberPhone;
  final String memberAddress;
  final String memberMapsUrl;

  /// Titik lokasi kerja job ini bila berbeda dari alamat member (kosong = ikut alamat member).
  final String workAddress;
  final String workMapsUrl;
  final String unitBrand;
  final String unitModel;
  final double unitPk;
  final String unitRoom;
  final String unitBarcode;

  /// Paket unit, mis. `Indoor AC FT123 · Outdoor AC FK123` (kosong bila tak ada).
  final String unitParts;
  final String technicianName;

  /// Servis banyak AC: id job lain (unit lain) di order yang sama; kosong = servis satu unit.
  final List<String> siblingIds;

  /// Deskripsi Pekerjaan order (`service_orders.note`).
  final String? orderNote;

  /// Keterangan teknisi: catatan SATU ORDER untuk admin (`service_orders.technician_note`). Beda dari [notes]
  /// (Diagnosa / Catatan Pengerjaan per unit). Hanya terisi dari `GET /technician-jobs/:id`.
  final String? technicianNote;

  /// Riwayat alih tugas job ini (kosong bila tak pernah dialihkan).
  final List<JobHandover> handovers;

  /// Unit "QR dulu" (`menunggu_data`): merk/PK wajib dilengkapi lewat Scan Unit sebelum job bisa dimulai.
  final bool unitAwaitingData;

  /// Ringkasan temuan (judul + pencatat) untuk riwayat unit; tanpa foto.
  final List<({String title, String? by})> findingHeads;

  /// Job komplain (pengerjaan ulang tanpa tagihan): menunjuk job selesai yang dikomplain. Teknisi tak boleh
  /// membuka job awal (403), jadi hanya info ringkasnya yang dibawa.
  final String? complaintOfJobId;
  final DateTime? complaintOfCompletedAt;
  final String? complaintOfTechnicianName;

  bool get isComplaint => complaintOfJobId != null;

  /// Sudah discan = sudah dimulai (start mewajibkan scan barcode). Job yang dialihkan saat
  /// sedang dikerjakan kembali ke `assigned`: startedAt tetap terisi tapi wajib scan ulang.
  bool get scanned =>
      startedAt != null &&
      status != JobStatus.menungguPenugasan &&
      status != JobStatus.assigned;

  bool get hasWorkLocation => workAddress.trim().isNotEmpty || workMapsUrl.trim().isNotEmpty;

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
      reviewNote: data['review_note'] as String?,
      findingsSentAt: _toDate(data['findings_sent_at']),
      priced: (data['priced'] as bool?) ?? true,
      hasBeforePhoto: data['has_before_photo'] as bool?,
      startedAt: _toDate(data['started_at']),
      completedAt: _toDate(data['completed_at']),
      createdAt: _toDate(data['created_at']),
      memberName: (member?['name'] as String?) ?? '',
      memberPhone: (member?['phone'] as String?) ?? '',
      memberAddress: (member?['address'] as String?) ?? '',
      memberMapsUrl: (member?['maps_url'] as String?) ?? '',
      workAddress: (data['work_address'] as String?) ?? '',
      workMapsUrl: (data['work_maps_url'] as String?) ?? '',
      unitBrand: (unit?['brand'] as String?) ?? '',
      unitModel: (unit?['model'] as String?) ?? '',
      unitPk: numFromNest(unit?['pk'])?.toDouble() ?? 0,
      unitRoom: (unit?['room_location'] as String?) ?? '',
      unitBarcode: (unit?['barcode_value'] as String?) ?? '',
      unitParts: (unit?['parts'] as String?) ?? '',
      technicianName: (data['technician_name'] as String?) ?? '',
      siblingIds: [for (final i in (data['sibling_ids'] as List? ?? const [])) '$i'],
      orderNote: data['order_note'] as String?,
      technicianNote: data['order_technician_note'] as String?,
      handovers: [
        for (final h in (data['handovers'] as List? ?? const []))
          JobHandover.fromNest(Map<String, dynamic>.from(h as Map)),
      ],
      unitAwaitingData: unit?['status'] == 'menunggu_data',
      complaintOfJobId: data['complaint_of_job_id'] as String?,
      complaintOfCompletedAt: _toDate((data['complaint_of'] as Map?)?['completedAt']),
      complaintOfTechnicianName:
          ((data['complaint_of'] as Map?)?['technician'] as Map?)?['displayName'] as String?,
      findingHeads: [
        for (final f in (data['findings'] as List? ?? const []))
          (
            title: ((f as Map)['title'] as String?) ?? '',
            by: (f['createdBy'] as Map?)?['displayName'] as String?,
          ),
      ],
    );
  }
}
