/// Status unit AC (disimpan sebagai enum snake_case di Postgres).
enum AcUnitStatus {
  menungguPemasangan('menunggu_pemasangan', 'Menunggu Pemasangan'),
  aktif('aktif', 'Aktif'),
  dalamMaintenance('dalam_maintenance', 'Dalam Maintenance'),
  rusak('rusak', 'Rusak'),
  nonaktif('nonaktif', 'Nonaktif');

  const AcUnitStatus(this.value, this.label);

  final String value;
  final String label;

  /// Nilai tak dikenal jatuh ke [menungguPemasangan] (default saat create).
  static AcUnitStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => AcUnitStatus.menungguPemasangan,
      );
}

// Kolom timestamptz Postgres tiba sebagai string ISO-8601 lewat PostgREST.
DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

/// Unit AC milik member (tabel `member_ac_units`). `barcodeValue` kosong
/// sebelum digenerate RPC `generate_ac_unit_barcode`. Tanggal pasang/servis
/// diisi pada fase servis. `id` kosong saat create.
class AcUnit {
  const AcUnit({
    this.id = '',
    required this.memberId,
    required this.brand,
    required this.model,
    required this.pk,
    required this.roomLocation,
    this.barcodeValue = '',
    this.serialNumber,
    this.installationDate,
    this.lastServiceDate,
    this.nextServiceDate,
    this.status = AcUnitStatus.menungguPemasangan,
  });

  final String id;
  final String memberId;
  final String brand;
  final String model;
  final double pk;
  final String roomLocation;
  final String barcodeValue;
  final String? serialNumber;
  final DateTime? installationDate;
  final DateTime? lastServiceDate;
  final DateTime? nextServiceDate;
  final AcUnitStatus status;

  factory AcUnit.fromMap(String id, Map<String, dynamic> data) {
    return AcUnit(
      id: id,
      memberId: (data['member_id'] as String?) ?? '',
      brand: (data['brand'] as String?) ?? '',
      model: (data['model'] as String?) ?? '',
      pk: (data['pk'] as num?)?.toDouble() ?? 0,
      roomLocation: (data['room_location'] as String?) ?? '',
      barcodeValue: (data['barcode_value'] as String?) ?? '',
      serialNumber: data['serial_number'] as String?,
      installationDate: _toDate(data['installation_date']),
      lastServiceDate: _toDate(data['last_service_date']),
      nextServiceDate: _toDate(data['next_service_date']),
      status: AcUnitStatus.fromValue(data['status']),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'member_id': memberId,
      'brand': brand,
      'model': model,
      'pk': pk,
      'room_location': roomLocation,
      'barcode_value': barcodeValue,
      'serial_number': serialNumber,
      'installation_date': installationDate?.toUtc().toIso8601String(),
      'last_service_date': lastServiceDate?.toUtc().toIso8601String(),
      'next_service_date': nextServiceDate?.toUtc().toIso8601String(),
      'status': status.value,
    };
  }

  AcUnit copyWith({
    String? id,
    String? memberId,
    String? brand,
    String? model,
    double? pk,
    String? roomLocation,
    String? barcodeValue,
    String? serialNumber,
    DateTime? installationDate,
    DateTime? lastServiceDate,
    DateTime? nextServiceDate,
    AcUnitStatus? status,
  }) {
    return AcUnit(
      id: id ?? this.id,
      memberId: memberId ?? this.memberId,
      brand: brand ?? this.brand,
      model: model ?? this.model,
      pk: pk ?? this.pk,
      roomLocation: roomLocation ?? this.roomLocation,
      barcodeValue: barcodeValue ?? this.barcodeValue,
      serialNumber: serialNumber ?? this.serialNumber,
      installationDate: installationDate ?? this.installationDate,
      lastServiceDate: lastServiceDate ?? this.lastServiceDate,
      nextServiceDate: nextServiceDate ?? this.nextServiceDate,
      status: status ?? this.status,
    );
  }
}
