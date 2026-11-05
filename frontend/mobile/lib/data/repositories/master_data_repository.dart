import '../../core/api/api_client.dart';
import '../../core/utils/snake_keys.dart';
import '../models/product.dart';
import '../models/service_item.dart';
import '../models/sparepart.dart';
import 'crud_repository.dart';

/// Implementasi [CrudRepository] lewat backend NestJS untuk produk,
/// sparepart, dan jasa — pengganti [SupabaseCrudRepository] pada migrasi
/// Flutter -> Nest (pola sama seperti [NestItemCostRepository] di
/// `item_cost_repository.dart`).
///
/// [watchAll] = sekali GET `?status=all` (aktif + nonaktif, seperti dulu di
/// Supabase); tak ada realtime, jadi form simpan me-`ref.invalidate` provider
/// daftarnya. Data Supabase sudah tidak dipakai (sumber tunggal epos_db VPS).
/// Body request dibangun
/// manual dalam bentuk camelCase (bukan lewat `toMap()` yang snake_case,
/// itu punya Supabase) karena DTO Nest (mis. `CreateProductDto`) pakai nama
/// field camelCase persis sama dengan field Dart model ini.

Map<String, dynamic> productToNestBody(Product p) => {
      'name': p.name,
      'brand': p.brand,
      'type': p.type,
      'pk': p.pk,
      'inverter': p.inverter,
      'btu': p.btu,
      'watt': p.watt,
      'warranty': p.warranty,
      // buyPrice TIDAK ikut — sama seperti Product.toMap(), sudah pindah ke
      // item_costs (PUT /item-costs/product/:id), lihat product_form_screen.
      'sellPrice': p.sellPrice,
      'stock': p.stock,
      'photoUrl': p.photoUrl,
      'description': p.description,
      'category': p.category,
      'active': p.active,
    };

class NestProductRepository implements CrudRepository<Product> {
  const NestProductRepository(this._api);

  final ApiClient _api;

  @override
  Stream<List<Product>> watchAll() => _fetchAll(_api, '/products', Product.fromMap);

  @override
  Future<String> create(Product item) async {
    final json = await _api.post('/products', body: productToNestBody(item)) as Map;
    return json['id'] as String;
  }

  @override
  Future<void> update(String id, Product item) =>
      _api.patch('/products/$id', body: productToNestBody(item));
}

Map<String, dynamic> sparepartToNestBody(Sparepart s) => {
      'name': s.name,
      'sku': s.sku,
      'category': s.category,
      'unit': s.unit,
      // buyPrice TIDAK ikut — sama seperti Sparepart.toMap(), sudah pindah ke
      // item_costs (PUT /item-costs/sparepart/:id).
      'sellPrice': s.sellPrice,
      'stock': s.stock,
      'minStock': s.minStock,
      'active': s.active,
    };

class NestSparepartRepository implements CrudRepository<Sparepart> {
  const NestSparepartRepository(this._api);

  final ApiClient _api;

  @override
  Stream<List<Sparepart>> watchAll() => _fetchAll(_api, '/spareparts', Sparepart.fromMap);

  @override
  Future<String> create(Sparepart item) async {
    final json = await _api.post('/spareparts', body: sparepartToNestBody(item)) as Map;
    return json['id'] as String;
  }

  @override
  Future<void> update(String id, Sparepart item) =>
      _api.patch('/spareparts/$id', body: sparepartToNestBody(item));
}

Map<String, dynamic> serviceToNestBody(ServiceItem s) => {
      'name': s.name,
      'category': s.category,
      'basePrice': s.basePrice,
      'durationMinutes': s.durationMinutes,
      'description': s.description,
      'active': s.active,
    };

class NestServiceRepository implements CrudRepository<ServiceItem> {
  const NestServiceRepository(this._api);

  final ApiClient _api;

  @override
  Stream<List<ServiceItem>> watchAll() => _fetchAll(_api, '/services', ServiceItem.fromMap);

  @override
  Future<String> create(ServiceItem item) async {
    final json = await _api.post('/services', body: serviceToNestBody(item)) as Map;
    return json['id'] as String;
  }

  @override
  Future<void> update(String id, ServiceItem item) =>
      _api.patch('/services/$id', body: serviceToNestBody(item));
}

/// GET daftar master data (array) -> model, memakai fromMap snake_case yang sama dengan data Supabase lama.
Stream<List<T>> _fetchAll<T>(
    ApiClient api, String path, T Function(String id, Map<String, dynamic> data) fromMap) async* {
  final rows = await api.get('$path?status=all') as List;
  yield [for (final r in rows) fromMap((r as Map)['id'] as String, snakeKeys(r))];
}
