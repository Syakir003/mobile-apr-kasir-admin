/// Kategori AC yang tersedia untuk dropdown form produk.
const kProductCategories = <String>[
  'AC 1/2 PK',
  'AC 3/4 PK',
  'AC 1 PK',
  'AC 1.5 PK',
  'AC 2 PK',
  'Inverter',
  'Non-Inverter',
  'Cassette',
  'Standing Floor',
];

/// Produk AC master. Uang dalam rupiah (int). `id` kosong saat create.
class Product {
  const Product({
    this.id = '',
    required this.name,
    required this.brand,
    required this.type,
    required this.pk,
    required this.inverter,
    this.btu,
    this.watt,
    this.warranty,
    required this.buyPrice,
    required this.sellPrice,
    required this.stock,
    this.photoUrl,
    this.description,
    required this.category,
    this.active = true,
  });

  final String id;
  final String name;
  final String brand;
  final String type;
  final double pk;
  final bool inverter;
  final int? btu;
  final int? watt;
  final String? warranty;
  final int buyPrice;
  final int sellPrice;
  final int stock;
  final String? photoUrl;
  final String? description;
  final String category;
  final bool active;

  factory Product.fromMap(String id, Map<String, dynamic> data) {
    return Product(
      id: id,
      name: (data['name'] as String?) ?? '',
      brand: (data['brand'] as String?) ?? '',
      type: (data['type'] as String?) ?? '',
      pk: (data['pk'] as num?)?.toDouble() ?? 0,
      inverter: (data['inverter'] as bool?) ?? false,
      btu: (data['btu'] as num?)?.toInt(),
      watt: (data['watt'] as num?)?.toInt(),
      warranty: data['warranty'] as String?,
      buyPrice: (data['buy_price'] as num?)?.toInt() ?? 0,
      sellPrice: (data['sell_price'] as num?)?.toInt() ?? 0,
      stock: (data['stock'] as num?)?.toInt() ?? 0,
      photoUrl: data['photo_url'] as String?,
      description: data['description'] as String?,
      category: (data['category'] as String?) ?? '',
      active: (data['active'] as bool?) ?? true,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'brand': brand,
      'type': type,
      'pk': pk,
      'inverter': inverter,
      'btu': btu,
      'watt': watt,
      'warranty': warranty,
      'buy_price': buyPrice,
      'sell_price': sellPrice,
      'stock': stock,
      'photo_url': photoUrl,
      'description': description,
      'category': category,
      'active': active,
    };
  }

  Product copyWith({
    String? id,
    String? name,
    String? brand,
    String? type,
    double? pk,
    bool? inverter,
    int? btu,
    int? watt,
    String? warranty,
    int? buyPrice,
    int? sellPrice,
    int? stock,
    String? photoUrl,
    String? description,
    String? category,
    bool? active,
  }) {
    return Product(
      id: id ?? this.id,
      name: name ?? this.name,
      brand: brand ?? this.brand,
      type: type ?? this.type,
      pk: pk ?? this.pk,
      inverter: inverter ?? this.inverter,
      btu: btu ?? this.btu,
      watt: watt ?? this.watt,
      warranty: warranty ?? this.warranty,
      buyPrice: buyPrice ?? this.buyPrice,
      sellPrice: sellPrice ?? this.sellPrice,
      stock: stock ?? this.stock,
      photoUrl: photoUrl ?? this.photoUrl,
      description: description ?? this.description,
      category: category ?? this.category,
      active: active ?? this.active,
    );
  }
}
