import 'package:cloud_firestore/cloud_firestore.dart';

/// Status invoice (disimpan sebagai string snake_case di Firestore).
enum InvoiceStatus {
  belumDibayar('belum_dibayar', 'Belum Dibayar'),
  dp('dp', 'DP'),
  kurangBayar('kurang_bayar', 'Kurang Bayar'),
  lunas('lunas', 'Lunas'),
  refund('refund', 'Refund'),
  batal('batal', 'Batal');

  const InvoiceStatus(this.value, this.label);

  final String value;
  final String label;

  /// Nilai tak dikenal jatuh ke [belumDibayar] (default saat invoice dibuat).
  static InvoiceStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => InvoiceStatus.belumDibayar,
      );
}

/// Metode pembayaran manual (disimpan sebagai string snake_case di Firestore).
enum PaymentMethod {
  tunai('tunai', 'Tunai'),
  transfer('transfer', 'Transfer Bank'),
  qris('qris', 'QRIS Manual'),
  ewallet('ewallet', 'E-Wallet Manual');

  const PaymentMethod(this.value, this.label);

  final String value;
  final String label;

  /// Nilai tak dikenal jatuh ke [tunai] (default).
  static PaymentMethod fromValue(Object? value) => values.firstWhere(
        (m) => m.value == value,
        orElse: () => PaymentMethod.tunai,
      );
}

DateTime? _toDate(Object? v) => switch (v) {
      Timestamp t => t.toDate(),
      DateTime d => d,
      _ => null,
    };

/// Baris item invoice: snapshot dari transaksi (bentuk sama dengan
/// subcollection `transactions/{id}/items`). `kind`: 'product'|'sparepart'|'service'.
class InvoiceItem {
  const InvoiceItem({
    required this.kind,
    required this.refId,
    required this.name,
    required this.unit,
    required this.qty,
    required this.unitPrice,
    required this.lineTotal,
  });

  final String kind;
  final String refId;
  final String name;
  final String unit;
  final num qty;
  final int unitPrice;
  final int lineTotal;

  factory InvoiceItem.fromMap(Map<String, dynamic> data) {
    return InvoiceItem(
      kind: (data['kind'] as String?) ?? '',
      refId: (data['ref_id'] as String?) ?? '',
      name: (data['name'] as String?) ?? '',
      unit: (data['unit'] as String?) ?? '',
      qty: (data['qty'] as num?) ?? 0,
      unitPrice: (data['unit_price'] as num?)?.toInt() ?? 0,
      lineTotal: (data['line_total'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'kind': kind,
      'ref_id': refId,
      'name': name,
      'unit': unit,
      'qty': qty,
      'unit_price': unitPrice,
      'line_total': lineTotal,
    };
  }
}

/// Invoice/struk (koleksi `invoices`). Ditulis hanya oleh Cloud Functions
/// (`checkoutTransaction`, `recordPayment`); client hanya membaca lewat
/// [InvoiceRepository]. `id` kosong bila belum tersimpan.
class Invoice {
  const Invoice({
    this.id = '',
    required this.number,
    required this.transactionId,
    required this.memberId,
    required this.customerName,
    required this.customerPhone,
    this.items = const [],
    required this.subtotal,
    this.discount = 0,
    this.taxPercent = 0,
    this.taxAmount = 0,
    this.transportFee = 0,
    required this.grandTotal,
    this.totalPaid = 0,
    this.status = InvoiceStatus.belumDibayar,
    this.notes,
    this.createdAt,
  });

  final String id;
  final String number;
  final String transactionId;
  final String memberId;
  final String customerName;
  final String customerPhone;
  final List<InvoiceItem> items;
  final int subtotal;
  final int discount;
  final double taxPercent;
  final int taxAmount;
  final int transportFee;
  final int grandTotal;
  final int totalPaid;
  final InvoiceStatus status;
  final String? notes;
  final DateTime? createdAt;

  /// Sisa tagihan yang belum dibayar.
  int get sisa => grandTotal - totalPaid;

  factory Invoice.fromMap(String id, Map<String, dynamic> data) {
    final rawItems = (data['items'] as List<dynamic>?) ?? const [];
    return Invoice(
      id: id,
      number: (data['number'] as String?) ?? '',
      transactionId: (data['transaction_id'] as String?) ?? '',
      memberId: (data['member_id'] as String?) ?? '',
      customerName: (data['customer_name'] as String?) ?? '',
      customerPhone: (data['customer_phone'] as String?) ?? '',
      items: rawItems
          .map(
            (e) => InvoiceItem.fromMap(Map<String, dynamic>.from(e as Map)),
          )
          .toList(growable: false),
      subtotal: (data['subtotal'] as num?)?.toInt() ?? 0,
      discount: (data['discount'] as num?)?.toInt() ?? 0,
      taxPercent: (data['tax_percent'] as num?)?.toDouble() ?? 0,
      taxAmount: (data['tax_amount'] as num?)?.toInt() ?? 0,
      transportFee: (data['transport_fee'] as num?)?.toInt() ?? 0,
      grandTotal: (data['grand_total'] as num?)?.toInt() ?? 0,
      totalPaid: (data['total_paid'] as num?)?.toInt() ?? 0,
      status: InvoiceStatus.fromValue(data['status']),
      notes: data['notes'] as String?,
      createdAt: _toDate(data['created_at']),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'number': number,
      'transaction_id': transactionId,
      'member_id': memberId,
      'customer_name': customerName,
      'customer_phone': customerPhone,
      'items': items.map((e) => e.toMap()).toList(growable: false),
      'subtotal': subtotal,
      'discount': discount,
      'tax_percent': taxPercent,
      'tax_amount': taxAmount,
      'transport_fee': transportFee,
      'grand_total': grandTotal,
      'total_paid': totalPaid,
      'status': status.value,
      'notes': notes,
      'created_at': createdAt,
    };
  }

  Invoice copyWith({
    String? id,
    String? number,
    String? transactionId,
    String? memberId,
    String? customerName,
    String? customerPhone,
    List<InvoiceItem>? items,
    int? subtotal,
    int? discount,
    double? taxPercent,
    int? taxAmount,
    int? transportFee,
    int? grandTotal,
    int? totalPaid,
    InvoiceStatus? status,
    String? notes,
    DateTime? createdAt,
  }) {
    return Invoice(
      id: id ?? this.id,
      number: number ?? this.number,
      transactionId: transactionId ?? this.transactionId,
      memberId: memberId ?? this.memberId,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      items: items ?? this.items,
      subtotal: subtotal ?? this.subtotal,
      discount: discount ?? this.discount,
      taxPercent: taxPercent ?? this.taxPercent,
      taxAmount: taxAmount ?? this.taxAmount,
      transportFee: transportFee ?? this.transportFee,
      grandTotal: grandTotal ?? this.grandTotal,
      totalPaid: totalPaid ?? this.totalPaid,
      status: status ?? this.status,
      notes: notes ?? this.notes,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
