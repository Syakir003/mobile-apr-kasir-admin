import '../../core/utils/num_parse.dart';

/// Sparepart / material master. Uang dalam rupiah (int); stok bisa pecahan (num).
class Sparepart {
  const Sparepart({
    this.id = '',
    required this.name,
    required this.sku,
    required this.category,
    required this.unit,
    required this.buyPrice,
    required this.sellPrice,
    required this.stock,
    required this.minStock,
    this.active = true,
    this.trackingMode = 'biasa',
    this.packUnit = '',
    this.packSize,
    this.sellPricePack = 0,
    this.pendingPrice = false,
  });

  final String id;
  final String name;
  final String sku;
  final String category;
  final String unit;
  final int buyPrice;
  final int sellPrice;
  final num stock;
  final num minStock;
  final bool active;

  /// Hanya dipakai saat membuat baru: 'biasa' | 'gabungan' | 'konversi' | 'gulungan'.
  final String trackingMode;
  final String packUnit; // tabung, roll, dus
  final num? packSize; // isi per packUnit, dalam [unit]
  final int sellPricePack;

  /// Didaftarkan gudang, harga belum lengkap (aturan sama dengan server).
  final bool pendingPrice;

  factory Sparepart.fromMap(String id, Map<String, dynamic> data) {
    return Sparepart(
      id: id,
      name: (data['name'] as String?) ?? '',
      sku: (data['sku'] as String?) ?? '',
      category: (data['category'] as String?) ?? '',
      unit: (data['unit'] as String?) ?? '',
      buyPrice: numFromNest(data['buy_price'])?.toInt() ?? 0,
      sellPrice: numFromNest(data['sell_price'])?.toInt() ?? 0,
      stock: numFromNest(data['stock']) ?? 0,
      minStock: numFromNest(data['min_stock']) ?? 0,
      active: (data['active'] as bool?) ?? true,
      // Gudang tidak menerima harga: server mengirim penandanya.
      pendingPrice: data['pending_price'] as bool? ??
          data['active'] == false &&
          (!((numFromNest(data['sell_price']) ?? 0) > 0) ||
              (const ['konversi', 'gabungan'].contains(data['tracking_mode']) &&
                  !((numFromNest(data['sell_price_pack']) ?? 0) > 0))),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'sku': sku,
      'category': category,
      'unit': unit,
      // `buy_price` TIDAK ikut — sudah pindah ke `item_costs` (migrasi 0021).
      'sell_price': sellPrice,
      'stock': stock,
      'min_stock': minStock,
      'active': active,
    };
  }

  Sparepart copyWith({
    String? id,
    String? name,
    String? sku,
    String? category,
    String? unit,
    int? buyPrice,
    int? sellPrice,
    num? stock,
    num? minStock,
    bool? active,
  }) {
    return Sparepart(
      id: id ?? this.id,
      name: name ?? this.name,
      sku: sku ?? this.sku,
      category: category ?? this.category,
      unit: unit ?? this.unit,
      buyPrice: buyPrice ?? this.buyPrice,
      sellPrice: sellPrice ?? this.sellPrice,
      stock: stock ?? this.stock,
      minStock: minStock ?? this.minStock,
      active: active ?? this.active,
    );
  }
}
