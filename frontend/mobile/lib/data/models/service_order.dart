/// Status order service (text di Postgres). Nilai dari checkout: 'terjadwal';
/// berubah 'selesai' saat semua unit selesai, 'dibatalkan' bila dibatalkan.
enum OrderStatus {
  draft('draft', 'Draft'),
  terjadwal('terjadwal', 'Terjadwal'),
  dalamPengerjaan('dalam_pengerjaan', 'Dalam Pengerjaan'),
  selesai('selesai', 'Selesai'),
  dibatalkan('dibatalkan', 'Dibatalkan');

  const OrderStatus(this.value, this.label);

  final String value;
  final String label;

  static OrderStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => OrderStatus.terjadwal,
      );
}

String orderTypeLabel(String type) => switch (type) {
      'pemasangan' => 'Pemasangan',
      'cuci' => 'Cuci AC',
      'service' => 'Service',
      'maintenance' => 'Maintenance',
      _ => type.isEmpty ? 'Order' : type,
    };

DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

/// Order jasa/pemasangan (tabel `service_orders`). `unitCount`/`doneCount`
/// diisi repositori dari `service_order_units`.
class ServiceOrder {
  const ServiceOrder({
    required this.id,
    required this.memberId,
    this.invoiceId,
    required this.type,
    required this.status,
    this.createdAt,
    this.memberName = '',
    this.unitCount = 0,
    this.doneCount = 0,
  });

  final String id;
  final String memberId;
  final String? invoiceId;
  final String type;
  final OrderStatus status;
  final DateTime? createdAt;

  // Enrichment.
  final String memberName;
  final int unitCount;
  final int doneCount;

  String get typeLabel => orderTypeLabel(type);

  factory ServiceOrder.fromMap(String id, Map<String, dynamic> data) {
    final member = data['member'] as Map<String, dynamic>?;
    return ServiceOrder(
      id: id,
      memberId: (data['member_id'] as String?) ?? '',
      invoiceId: data['invoice_id'] as String?,
      type: (data['type'] as String?) ?? 'pemasangan',
      status: OrderStatus.fromValue(data['status']),
      createdAt: _toDate(data['created_at']),
      memberName: (member?['name'] as String?) ?? '',
      unitCount: (data['unit_count'] as num?)?.toInt() ?? 0,
      doneCount: (data['done_count'] as num?)?.toInt() ?? 0,
    );
  }
}
