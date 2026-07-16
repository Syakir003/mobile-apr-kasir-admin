/// Item di dalam paket instalasi: referensi ke sparepart + kuantitas + harga
/// ekstra per unit (default dari sellPrice sparepart, bisa diedit).
class PackageItem {
  const PackageItem({
    required this.sparepartId,
    required this.name,
    required this.qty,
    required this.unit,
    required this.extraPricePerUnit,
  });

  final String sparepartId;
  final String name;
  final num qty;
  final String unit;
  final int extraPricePerUnit;

  factory PackageItem.fromMap(Map<String, dynamic> data) {
    return PackageItem(
      sparepartId: (data['sparepart_id'] as String?) ?? '',
      name: (data['name'] as String?) ?? '',
      qty: (data['qty'] as num?) ?? 0,
      unit: (data['unit'] as String?) ?? '',
      extraPricePerUnit: (data['extra_price_per_unit'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'sparepart_id': sparepartId,
      'name': name,
      'qty': qty,
      'unit': unit,
      'extra_price_per_unit': extraPricePerUnit,
    };
  }

  PackageItem copyWith({
    String? sparepartId,
    String? name,
    num? qty,
    String? unit,
    int? extraPricePerUnit,
  }) {
    return PackageItem(
      sparepartId: sparepartId ?? this.sparepartId,
      name: name ?? this.name,
      qty: qty ?? this.qty,
      unit: unit ?? this.unit,
      extraPricePerUnit: extraPricePerUnit ?? this.extraPricePerUnit,
    );
  }
}

/// Paket instalasi master: kumpulan [PackageItem] yang bisa dipakai saat order.
class InstallationPackage {
  const InstallationPackage({
    this.id = '',
    required this.name,
    this.description,
    this.items = const [],
    this.active = true,
  });

  final String id;
  final String name;
  final String? description;
  final List<PackageItem> items;
  final bool active;

  factory InstallationPackage.fromMap(String id, Map<String, dynamic> data) {
    final rawItems = (data['items'] as List<dynamic>?) ?? const [];
    return InstallationPackage(
      id: id,
      name: (data['name'] as String?) ?? '',
      description: data['description'] as String?,
      items: rawItems
          .map((e) => PackageItem.fromMap(
                Map<String, dynamic>.from(e as Map),
              ))
          .toList(growable: false),
      active: (data['active'] as bool?) ?? true,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'description': description,
      'items': items.map((e) => e.toMap()).toList(growable: false),
      'active': active,
    };
  }

  InstallationPackage copyWith({
    String? id,
    String? name,
    String? description,
    List<PackageItem>? items,
    bool? active,
  }) {
    return InstallationPackage(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      items: items ?? this.items,
      active: active ?? this.active,
    );
  }
}
