/// Kategori sparepart/material untuk dropdown form.
const kSparepartCategories = <String>[
  'sparepart',
  'material',
  'aksesoris',
  'consumable',
];

/// Satuan unit untuk sparepart & item paket.
const kUnits = <String>[
  'pcs',
  'meter',
  'roll',
  'set',
  'kg',
  'tabung',
  'liter',
];

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

  factory Sparepart.fromMap(String id, Map<String, dynamic> data) {
    return Sparepart(
      id: id,
      name: (data['name'] as String?) ?? '',
      sku: (data['sku'] as String?) ?? '',
      category: (data['category'] as String?) ?? '',
      unit: (data['unit'] as String?) ?? '',
      buyPrice: (data['buy_price'] as num?)?.toInt() ?? 0,
      sellPrice: (data['sell_price'] as num?)?.toInt() ?? 0,
      stock: (data['stock'] as num?) ?? 0,
      minStock: (data['min_stock'] as num?) ?? 0,
      active: (data['active'] as bool?) ?? true,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'sku': sku,
      'category': category,
      'unit': unit,
      'buy_price': buyPrice,
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
