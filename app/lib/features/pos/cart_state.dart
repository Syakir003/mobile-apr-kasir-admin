import '../../core/utils/phone.dart';

/// Jenis baris keranjang, sesuai `CheckoutItem.kind` pada kontrak
/// `checkoutTransaction` (`functions/src/pos/validation.ts`).
enum CartItemKind { product, sparepart, service }

/// Satu baris keranjang POS. `unitPrice` HANYA untuk pratinjau di client —
/// server SELALU menghitung ulang harga dari data master saat checkout
/// (client tidak pernah mengirim harga di payload).
class CartLine {
  const CartLine({
    required this.kind,
    required this.refId,
    required this.name,
    required this.unit,
    required this.unitPrice,
    required this.qty,
    this.withInstallation = false,
    this.roomLocation = '',
    this.technicianId,
  });

  final CartItemKind kind;
  final String refId;
  final String name;
  final String unit;
  final int unitPrice;
  final num qty;
  final bool withInstallation;
  final String roomLocation;
  final String? technicianId;

  /// Subtotal baris: `round(qty * unitPrice)`, sama seperti rumus server.
  int get lineTotal => (qty * unitPrice).round();

  /// [clearTechnicianId]: set true untuk secara eksplisit mengosongkan
  /// [technicianId] (dropdown "Belum ditentukan"); tanpa flag ini,
  /// `technicianId: null` diperlakukan sebagai "tidak diganti".
  CartLine copyWith({
    CartItemKind? kind,
    String? refId,
    String? name,
    String? unit,
    int? unitPrice,
    num? qty,
    bool? withInstallation,
    String? roomLocation,
    String? technicianId,
    bool clearTechnicianId = false,
  }) {
    return CartLine(
      kind: kind ?? this.kind,
      refId: refId ?? this.refId,
      name: name ?? this.name,
      unit: unit ?? this.unit,
      unitPrice: unitPrice ?? this.unitPrice,
      qty: qty ?? this.qty,
      withInstallation: withInstallation ?? this.withInstallation,
      roomLocation: roomLocation ?? this.roomLocation,
      technicianId:
          clearTechnicianId ? null : (technicianId ?? this.technicianId),
    );
  }
}

/// Keranjang POS untuk satu sesi transaksi. Diskon (Rp) + pajak (%) +
/// transport berlaku level transaksi saja (bukan per baris), sesuai
/// keputusan desain fase 4.
class Cart {
  const Cart({
    this.lines = const [],
    this.discount = 0,
    this.taxPercent = 0,
    this.transportFee = 0,
    this.customerName = '',
    this.customerPhone = '',
    this.customerAddress = '',
    this.notes = '',
  });

  final List<CartLine> lines;
  final int discount;
  final double taxPercent;
  final int transportFee;
  final String customerName;
  final String customerPhone;
  final String customerAddress;
  final String notes;

  Cart copyWith({
    List<CartLine>? lines,
    int? discount,
    double? taxPercent,
    int? transportFee,
    String? customerName,
    String? customerPhone,
    String? customerAddress,
    String? notes,
  }) {
    return Cart(
      lines: lines ?? this.lines,
      discount: discount ?? this.discount,
      taxPercent: taxPercent ?? this.taxPercent,
      transportFee: transportFee ?? this.transportFee,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      customerAddress: customerAddress ?? this.customerAddress,
      notes: notes ?? this.notes,
    );
  }
}

/// Menghitung total keranjang. Rumus IDENTIK dengan `computeTotals` di
/// `functions/src/pos/totals.ts` (Global Constraints fase 4):
///
/// `lineTotal = round(qty * unitPrice)`; `subtotal = sum(lineTotal)`;
/// `taxBase = subtotal - discount`; `taxAmount = round(taxBase * taxPercent / 100)`;
/// `grandTotal = taxBase + taxAmount + transportFee`.
///
/// Transport TIDAK kena pajak.
({int subtotal, int taxAmount, int grandTotal}) computeCartTotals(Cart cart) {
  final subtotal =
      cart.lines.fold<int>(0, (sum, line) => sum + line.lineTotal);
  final taxBase = subtotal - cart.discount;
  final taxAmount = (taxBase * cart.taxPercent / 100).round();
  final grandTotal = taxBase + taxAmount + cart.transportFee;
  return (subtotal: subtotal, taxAmount: taxAmount, grandTotal: grandTotal);
}

/// Menggabungkan [line] baru ke [lines]: baris dengan kind+refId sama
/// digabung qty-nya (qty lama + qty baru; field lain seperti
/// withInstallation/roomLocation/technicianId dari baris lama dipertahankan).
/// Server juga menolak kind+refId duplikat pada `items`, jadi baris di
/// keranjang HARUS unik per kind+refId — dipakai oleh `CartNotifier.addLine`
/// (`pos_providers.dart`).
List<CartLine> mergeCartLine(List<CartLine> lines, CartLine line) {
  final idx =
      lines.indexWhere((l) => l.kind == line.kind && l.refId == line.refId);
  if (idx == -1) return [...lines, line];
  final merged = [...lines];
  merged[idx] = merged[idx].copyWith(qty: merged[idx].qty + line.qty);
  return merged;
}

/// Membangun payload `checkoutTransaction` (bentuk `CheckoutInput`,
/// `functions/src/pos/validation.ts`) dari [cart]. Harga TIDAK pernah
/// dikirim — server selalu resolve dari master data. Nomor HP dinormalisasi
/// dengan [normalizePhone]. Field opsional kosong (`address`/`notes`)
/// dihilangkan; `discount`/`taxPercent`/`transportFee` selalu disertakan
/// (0 adalah nilai valid). `installations`: satu entri per unit qty untuk
/// baris product yang ditandai `withInstallation` (`itemIndex` = posisi
/// baris pada `items`); dihilangkan bila kosong.
Map<String, dynamic> buildCheckoutPayload(Cart cart) {
  final customer = <String, dynamic>{
    'name': cart.customerName,
    'phone': normalizePhone(cart.customerPhone),
  };
  final address = cart.customerAddress.trim();
  if (address.isNotEmpty) customer['address'] = address;

  final items = [
    for (final line in cart.lines)
      {'kind': line.kind.name, 'refId': line.refId, 'qty': line.qty},
  ];

  final installations = <Map<String, dynamic>>[];
  for (var i = 0; i < cart.lines.length; i++) {
    final line = cart.lines[i];
    if (line.kind != CartItemKind.product || !line.withInstallation) {
      continue;
    }
    final unitCount = line.qty.round();
    for (var j = 0; j < unitCount; j++) {
      final inst = <String, dynamic>{'itemIndex': i};
      final room = line.roomLocation.trim();
      if (room.isNotEmpty) inst['roomLocation'] = room;
      final tech = line.technicianId;
      if (tech != null && tech.isNotEmpty) inst['technicianId'] = tech;
      installations.add(inst);
    }
  }

  final payload = <String, dynamic>{
    'customer': customer,
    'items': items,
    'discount': cart.discount,
    'taxPercent': cart.taxPercent,
    'transportFee': cart.transportFee,
  };
  final notes = cart.notes.trim();
  if (notes.isNotEmpty) payload['notes'] = notes;
  if (installations.isNotEmpty) payload['installations'] = installations;
  return payload;
}

/// Format rupiah sederhana tanpa dependensi `intl`: pemisah ribuan titik.
/// Contoh: `104900` -> `'Rp 104.900'`.
String formatRupiah(int value) {
  final negative = value < 0;
  final digits = value.abs().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return 'Rp ${negative ? '-' : ''}$buffer';
}
