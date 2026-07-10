import 'package:cloud_firestore/cloud_firestore.dart';

/// Jenis pelanggan untuk dropdown form member.
const kCustomerTypes = <String>[
  'rumah',
  'kantor',
  'toko',
  'perusahaan',
  'lainnya',
];

DateTime? _toDate(Object? v) => switch (v) {
      Timestamp t => t.toDate(),
      DateTime d => d,
      _ => null,
    };

/// Member/pelanggan (koleksi `members`). Nomor HP tersimpan ternormalisasi
/// (lihat `normalizePhone`) dan menjadi identitas unik. `memberSince` null
/// saat dibuat manual sebelum ada transaksi. `id` kosong saat create.
class Member {
  const Member({
    this.id = '',
    required this.name,
    required this.phone,
    required this.address,
    required this.customerType,
    this.memberSince,
    this.totalAcUnits = 0,
    this.notes,
    this.active = true,
  });

  final String id;
  final String name;
  final String phone;
  final String address;
  final String customerType;
  final DateTime? memberSince;
  final int totalAcUnits;
  final String? notes;
  final bool active;

  factory Member.fromMap(String id, Map<String, dynamic> data) {
    return Member(
      id: id,
      name: (data['name'] as String?) ?? '',
      phone: (data['phone'] as String?) ?? '',
      address: (data['address'] as String?) ?? '',
      customerType: (data['customer_type'] as String?) ?? 'lainnya',
      memberSince: _toDate(data['member_since']),
      totalAcUnits: (data['total_ac_units'] as num?)?.toInt() ?? 0,
      notes: data['notes'] as String?,
      active: (data['active'] as bool?) ?? true,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'phone': phone,
      'address': address,
      'customer_type': customerType,
      'member_since': memberSince,
      'total_ac_units': totalAcUnits,
      'notes': notes,
      'active': active,
    };
  }

  Member copyWith({
    String? id,
    String? name,
    String? phone,
    String? address,
    String? customerType,
    DateTime? memberSince,
    int? totalAcUnits,
    String? notes,
    bool? active,
  }) {
    return Member(
      id: id ?? this.id,
      name: name ?? this.name,
      phone: phone ?? this.phone,
      address: address ?? this.address,
      customerType: customerType ?? this.customerType,
      memberSince: memberSince ?? this.memberSince,
      totalAcUnits: totalAcUnits ?? this.totalAcUnits,
      notes: notes ?? this.notes,
      active: active ?? this.active,
    );
  }
}
