import 'invoice.dart' show PaymentMethod;

// Kolom timestamptz Postgres tiba sebagai string ISO-8601 lewat PostgREST.
DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

/// Pembayaran manual untuk sebuah invoice (tabel `manual_payments`).
/// Ditulis hanya oleh RPC `record_payment`; client hanya membaca
/// lewat [InvoiceRepository.watchPayments]. `id` kosong bila belum tersimpan.
/// `proofUrl` masih null di Fase 4 (upload bukti bayar menyusul fase
/// berikutnya).
class ManualPayment {
  const ManualPayment({
    this.id = '',
    required this.invoiceId,
    required this.method,
    required this.amount,
    this.cashReceived,
    this.note,
    this.proofUrl,
    required this.createdBy,
    this.createdAt,
  });

  final String id;
  final String invoiceId;
  final PaymentMethod method;

  /// Uang yang masuk ke tagihan (di-clamp ke sisa untuk tunai lebih).
  final int amount;

  /// Uang tunai fisik yang diserahkan pelanggan; null bila non-tunai / pas.
  final int? cashReceived;
  final String? note;
  final String? proofUrl;
  final String createdBy;
  final DateTime? createdAt;

  /// Kembalian = uang diterima − yang masuk tagihan (0 bila tak ada `cashReceived`).
  int get change =>
      (cashReceived != null && cashReceived! > amount) ? cashReceived! - amount : 0;

  factory ManualPayment.fromMap(String id, Map<String, dynamic> data) {
    return ManualPayment(
      id: id,
      invoiceId: (data['invoice_id'] as String?) ?? '',
      method: PaymentMethod.fromValue(data['method']),
      amount: (data['amount'] as num?)?.toInt() ?? 0,
      cashReceived: (data['cash_received'] as num?)?.toInt(),
      note: data['note'] as String?,
      proofUrl: data['proof_url'] as String?,
      createdBy: (data['created_by'] as String?) ?? '',
      createdAt: _toDate(data['created_at']),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'invoice_id': invoiceId,
      'method': method.value,
      'amount': amount,
      'cash_received': cashReceived,
      'note': note,
      'proof_url': proofUrl,
      'created_by': createdBy,
      'created_at': createdAt?.toUtc().toIso8601String(),
    };
  }

  ManualPayment copyWith({
    String? id,
    String? invoiceId,
    PaymentMethod? method,
    int? amount,
    int? cashReceived,
    String? note,
    String? proofUrl,
    String? createdBy,
    DateTime? createdAt,
  }) {
    return ManualPayment(
      id: id ?? this.id,
      invoiceId: invoiceId ?? this.invoiceId,
      method: method ?? this.method,
      amount: amount ?? this.amount,
      cashReceived: cashReceived ?? this.cashReceived,
      note: note ?? this.note,
      proofUrl: proofUrl ?? this.proofUrl,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
