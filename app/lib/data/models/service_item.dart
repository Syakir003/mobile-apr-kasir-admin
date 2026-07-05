/// Jasa master (mis. pasang, cuci, servis). Uang dalam rupiah (int).
class ServiceItem {
  const ServiceItem({
    this.id = '',
    required this.name,
    required this.category,
    required this.basePrice,
    this.durationMinutes,
    this.description,
    this.active = true,
  });

  final String id;
  final String name;
  final String category;
  final int basePrice;
  final int? durationMinutes;
  final String? description;
  final bool active;

  factory ServiceItem.fromMap(String id, Map<String, dynamic> data) {
    return ServiceItem(
      id: id,
      name: (data['name'] as String?) ?? '',
      category: (data['category'] as String?) ?? '',
      basePrice: (data['basePrice'] as num?)?.toInt() ?? 0,
      durationMinutes: (data['durationMinutes'] as num?)?.toInt(),
      description: data['description'] as String?,
      active: (data['active'] as bool?) ?? true,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'category': category,
      'basePrice': basePrice,
      'durationMinutes': durationMinutes,
      'description': description,
      'active': active,
    };
  }

  ServiceItem copyWith({
    String? id,
    String? name,
    String? category,
    int? basePrice,
    int? durationMinutes,
    String? description,
    bool? active,
  }) {
    return ServiceItem(
      id: id ?? this.id,
      name: name ?? this.name,
      category: category ?? this.category,
      basePrice: basePrice ?? this.basePrice,
      durationMinutes: durationMinutes ?? this.durationMinutes,
      description: description ?? this.description,
      active: active ?? this.active,
    );
  }
}
