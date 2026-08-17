DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

enum VoucherDiscountType {
  persen('persen'),
  nominal('nominal');

  const VoucherDiscountType(this.value);
  final String value;

  static VoucherDiscountType fromValue(Object? value) => values.firstWhere(
        (t) => t.value == value,
        orElse: () => VoucherDiscountType.nominal,
      );
}

enum VoucherStatus {
  aktif('aktif', 'Aktif'),
  terpakai('terpakai', 'Terpakai'),
  kadaluarsa('kadaluarsa', 'Kadaluarsa'),
  dibatalkan('dibatalkan', 'Dibatalkan');

  const VoucherStatus(this.value, this.label);
  final String value;
  final String label;

  static VoucherStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => VoucherStatus.aktif,
      );
}

enum VoucherSource {
  undian('undian'),
  manual('manual');

  const VoucherSource(this.value);
  final String value;

  static VoucherSource fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => VoucherSource.manual,
      );
}

/// Satu voucher (tabel `vouchers`) — terikat ke satu [memberId], ditukar
/// dengan cara diinput admin/kasir sebagai kode saat checkout. Tidak ada
/// langkah "klaim" terpisah dari pemakaiannya.
class Voucher {
  const Voucher({
    required this.id,
    required this.code,
    required this.memberId,
    required this.discountType,
    required this.discountValue,
    this.maxDiscountCap,
    this.minPurchase,
    required this.expiresAt,
    required this.status,
    required this.source,
    this.note,
    this.createdAt,
  });

  final String id;
  final String code;
  final String memberId;
  final VoucherDiscountType discountType;
  final int discountValue;
  final int? maxDiscountCap;
  final int? minPurchase;
  final DateTime expiresAt;
  final VoucherStatus status;
  final VoucherSource source;
  final String? note;
  final DateTime? createdAt;

  /// Deskripsi nilai potongan untuk UI, mis. "10%" / "Rp 200000".
  String get discountLabel => discountType == VoucherDiscountType.persen
      ? '$discountValue%'
      : 'Rp $discountValue';

  factory Voucher.fromMap(String id, Map<String, dynamic> data) => Voucher(
        id: id,
        code: (data['code'] as String?) ?? '',
        memberId: (data['member_id'] as String?) ?? '',
        discountType: VoucherDiscountType.fromValue(data['discount_type']),
        discountValue: (data['discount_value'] as num?)?.toInt() ?? 0,
        maxDiscountCap: (data['max_discount_cap'] as num?)?.toInt(),
        minPurchase: (data['min_purchase'] as num?)?.toInt(),
        expiresAt: _toDate(data['expires_at']) ?? DateTime(2000),
        status: VoucherStatus.fromValue(data['status']),
        source: VoucherSource.fromValue(data['source']),
        note: data['note'] as String?,
        createdAt: _toDate(data['created_at']),
      );
}
