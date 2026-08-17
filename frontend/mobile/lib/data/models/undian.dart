import 'voucher.dart' show VoucherDiscountType;

DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

enum UndianStatus {
  berjalan('berjalan', 'Berjalan'),
  selesai('selesai', 'Selesai'),
  dibatalkan('dibatalkan', 'Dibatalkan');

  const UndianStatus(this.value, this.label);
  final String value;
  final String label;

  static UndianStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => UndianStatus.berjalan,
      );
}

/// Satu undian (tabel `undian`) — hadiahnya SATU macam diskon untuk semua
/// pemenang, ditentukan saat undian dibuat (bukan per-pemenang).
class Undian {
  const Undian({
    required this.id,
    required this.title,
    this.description,
    required this.winnerCount,
    required this.discountType,
    required this.discountValue,
    this.maxDiscountCap,
    this.minPurchase,
    required this.voucherValidDays,
    required this.status,
    this.drawnAt,
    this.createdAt,
  });

  final String id;
  final String title;
  final String? description;
  final int winnerCount;
  final VoucherDiscountType discountType;
  final int discountValue;
  final int? maxDiscountCap;
  final int? minPurchase;
  final int voucherValidDays;
  final UndianStatus status;
  final DateTime? drawnAt;
  final DateTime? createdAt;

  String get discountLabel => discountType == VoucherDiscountType.persen
      ? '$discountValue%'
      : 'Rp $discountValue';

  factory Undian.fromMap(String id, Map<String, dynamic> data) => Undian(
        id: id,
        title: (data['title'] as String?) ?? '',
        description: data['description'] as String?,
        winnerCount: (data['winner_count'] as num?)?.toInt() ?? 0,
        discountType: VoucherDiscountType.fromValue(data['discount_type']),
        discountValue: (data['discount_value'] as num?)?.toInt() ?? 0,
        maxDiscountCap: (data['max_discount_cap'] as num?)?.toInt(),
        minPurchase: (data['min_purchase'] as num?)?.toInt(),
        voucherValidDays: (data['voucher_valid_days'] as num?)?.toInt() ?? 0,
        status: UndianStatus.fromValue(data['status']),
        drawnAt: _toDate(data['drawn_at']),
        createdAt: _toDate(data['created_at']),
      );
}

/// Satu peserta undian (tabel `undian_participants`).
class UndianParticipant {
  const UndianParticipant({
    required this.id,
    required this.undianId,
    required this.memberId,
    required this.source,
  });

  final String id;
  final String undianId;
  final String memberId;
  final String source; // 'otomatis' | 'manual'

  factory UndianParticipant.fromMap(String id, Map<String, dynamic> data) =>
      UndianParticipant(
        id: id,
        undianId: (data['undian_id'] as String?) ?? '',
        memberId: (data['member_id'] as String?) ?? '',
        source: (data['source'] as String?) ?? 'manual',
      );
}
