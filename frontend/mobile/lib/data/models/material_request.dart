/// Status pengajuan tambahan sparepart/material.
enum RequestStatus {
  pending('pending', 'Menunggu'),
  approved('approved', 'Disetujui'),
  rejected('rejected', 'Ditolak');

  const RequestStatus(this.value, this.label);

  final String value;
  final String label;

  static RequestStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => RequestStatus.pending,
      );
}

// Kolom timestamptz Postgres tiba sebagai string ISO-8601 lewat PostgREST.
DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

/// Satu baris item pengajuan (tabel `material_request_items`).
class MaterialRequestItem {
  const MaterialRequestItem({
    required this.kind,
    required this.refId,
    required this.name,
    required this.unit,
    required this.qty,
    required this.unitPrice,
    required this.lineTotal,
  });

  final String kind; // 'product' | 'sparepart'
  final String refId;
  final String name;
  final String unit;
  final num qty;
  final int unitPrice;
  final int lineTotal;

  factory MaterialRequestItem.fromMap(Map<String, dynamic> data) =>
      MaterialRequestItem(
        kind: (data['kind'] as String?) ?? 'sparepart',
        refId: (data['ref_id'] as String?) ?? '',
        name: (data['name'] as String?) ?? '',
        unit: (data['unit'] as String?) ?? '',
        qty: (data['qty'] as num?) ?? 0,
        unitPrice: (data['unit_price'] as num?)?.toInt() ?? 0,
        lineTotal: (data['line_total'] as num?)?.toInt() ?? 0,
      );
}

/// Pengajuan tambahan sparepart/material oleh teknisi (tabel `material_requests`),
/// diperkaya dengan baris [items] lewat repositori.
class MaterialRequest {
  const MaterialRequest({
    required this.id,
    required this.jobId,
    required this.status,
    required this.total,
    this.invoiceId,
    this.note,
    this.decisionNote,
    this.createdAt,
    this.decidedAt,
    this.items = const [],
  });

  final String id;
  final String jobId;
  final RequestStatus status;
  final int total;
  final String? invoiceId;
  final String? note;
  final String? decisionNote;
  final DateTime? createdAt;
  final DateTime? decidedAt;
  final List<MaterialRequestItem> items;

  bool get isPending => status == RequestStatus.pending;

  factory MaterialRequest.fromMap(String id, Map<String, dynamic> data) =>
      MaterialRequest(
        id: id,
        jobId: (data['job_id'] as String?) ?? '',
        status: RequestStatus.fromValue(data['status']),
        total: (data['total'] as num?)?.toInt() ?? 0,
        invoiceId: data['invoice_id'] as String?,
        note: data['note'] as String?,
        decisionNote: data['decision_note'] as String?,
        createdAt: _toDate(data['created_at']),
        decidedAt: _toDate(data['decided_at']),
        items: [
          for (final it in (data['items'] as List? ?? const []))
            MaterialRequestItem.fromMap(Map<String, dynamic>.from(it as Map)),
        ],
      );
}
