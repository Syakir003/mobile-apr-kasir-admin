import '../../core/utils/currency.dart';
import '../../core/utils/phone.dart';

// Pemakai lama mengimpor `formatRupiah` dari sini; diteruskan agar impor
// `cart_state.dart` di layar POS tetap cukup.
export '../../core/utils/currency.dart' show formatRupiah;

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
    this.unitIds = const [],
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

  /// Unit AC member yang dikerjakan baris jasa ini (hanya untuk
  /// [CartItemKind.service]). Jumlahnya maksimal [qty] — satu unit = satu job
  /// teknisi yang lahir dari checkout (`serviceUnits` pada payload).
  final List<String> unitIds;

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
    List<String>? unitIds,
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
      unitIds: unitIds ?? this.unitIds,
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
    this.memberId = '',
    this.customerName = '',
    this.customerPhone = '',
    this.customerAddress = '',
    this.notes = '',
  });

  final List<CartLine> lines;
  final int discount;
  final double taxPercent;
  final int transportFee;

  /// Member yang dipilih dari daftar (kosong = pelanggan diketik manual).
  /// TIDAK ikut dikirim ke server: `checkout_transaction` mencocokkan member
  /// lewat nomor HP ternormalisasi. Field ini dipakai UI untuk mengunci
  /// nama/HP agar tidak salah ketik dan membuat member kembar.
  final String memberId;
  final String customerName;
  final String customerPhone;
  final String customerAddress;
  final String notes;

  /// [clearMember]: set true untuk melepas pilihan member (kembali ke mode
  /// pelanggan baru); tanpa flag ini `memberId: null` berarti "tidak diganti".
  Cart copyWith({
    List<CartLine>? lines,
    int? discount,
    double? taxPercent,
    int? transportFee,
    String? memberId,
    String? customerName,
    String? customerPhone,
    String? customerAddress,
    String? notes,
    bool clearMember = false,
  }) {
    return Cart(
      lines: lines ?? this.lines,
      discount: discount ?? this.discount,
      taxPercent: taxPercent ?? this.taxPercent,
      transportFee: transportFee ?? this.transportFee,
      memberId: clearMember ? '' : (memberId ?? this.memberId),
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
  // Diskon melebihi subtotal ditolak backend (`checkout_transaction`) dan
  // dikunci di form checkout. Dijepit di sini supaya pratinjau tidak sempat
  // menampilkan pajak & total NEGATIF selama pengguna masih mengetik.
  final taxBase = (subtotal - cart.discount).clamp(0, subtotal);
  final taxAmount = (taxBase * cart.taxPercent / 100).round();
  final grandTotal = taxBase + taxAmount + cart.transportFee;
  return (subtotal: subtotal, taxAmount: taxAmount, grandTotal: grandTotal);
}

/// Pesan kesalahan diskon, atau null bila sah. Dipakai form checkout untuk
/// menampilkan error inline sekaligus mengunci tombol submit — supaya tidak
/// perlu menunggu penolakan dari database.
String? cartDiscountError(Cart cart) {
  if (cart.discount < 0) return 'Diskon tidak boleh negatif';
  final subtotal = cart.lines.fold<int>(0, (sum, line) => sum + line.lineTotal);
  if (cart.discount > subtotal) {
    return 'Diskon melebihi subtotal (${formatRupiah(subtotal)})';
  }
  return null;
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

  final serviceUnits = <Map<String, dynamic>>[];
  for (var i = 0; i < cart.lines.length; i++) {
    final line = cart.lines[i];
    if (line.kind != CartItemKind.service) continue;
    for (final unitId in line.unitIds) {
      final entry = <String, dynamic>{'itemIndex': i, 'unitId': unitId};
      final tech = line.technicianId;
      if (tech != null && tech.isNotEmpty) entry['technicianId'] = tech;
      serviceUnits.add(entry);
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
  if (serviceUnits.isNotEmpty) payload['serviceUnits'] = serviceUnits;
  return payload;
}

/// Baris jasa yang unit AC-nya belum dipilih sepenuhnya (jumlah unit terpilih
/// < qty). Dipakai `checkout_screen.dart` untuk memblokir submit: satu unit =
/// satu job teknisi, jadi qty 3 harus menunjuk 3 unit.
///
/// Hanya relevan saat pelanggan adalah member terdaftar; qty pecahan (mis.
/// 1.5 jam jasa) dilewati karena tidak memetakan ke jumlah unit.
List<int> incompleteServiceLines(Cart cart) {
  final result = <int>[];
  for (var i = 0; i < cart.lines.length; i++) {
    final line = cart.lines[i];
    if (line.kind != CartItemKind.service) continue;
    if (line.qty != line.qty.roundToDouble()) continue;
    if (line.unitIds.length < line.qty.round()) result.add(i);
  }
  return result;
}
