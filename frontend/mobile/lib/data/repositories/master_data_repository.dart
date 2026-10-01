import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api/api_client.dart';
import '../models/product.dart';
import '../models/service_item.dart';
import '../models/sparepart.dart';
import 'crud_repository.dart';

/// Implementasi [CrudRepository] lewat backend NestJS untuk produk,
/// sparepart, dan jasa — pengganti [SupabaseCrudRepository] pada migrasi
/// Flutter -> Nest (pola sama seperti [NestItemCostRepository] di
/// `item_cost_repository.dart`).
///
/// [watchAll] TETAP lewat Supabase Realtime (delegasi ke sebuah
/// [SupabaseCrudRepository] internal) — realtime belum dipindah ke Nest,
/// hanya [create]/[update] (Future biasa) yang pindah. Body request dibangun
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
  NestProductRepository(SupabaseClient client, this._api)
      : _watcher = SupabaseCrudRepository<Product>(
          client,
          'products',
          Product.fromMap,
          (p) => p.toMap(),
        );

  final ApiClient _api;
  final SupabaseCrudRepository<Product> _watcher;

  @override
  Stream<List<Product>> watchAll() => _watcher.watchAll();

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
  NestSparepartRepository(SupabaseClient client, this._api)
      : _watcher = SupabaseCrudRepository<Sparepart>(
          client,
          'spareparts',
          Sparepart.fromMap,
          (s) => s.toMap(),
        );

  final ApiClient _api;
  final SupabaseCrudRepository<Sparepart> _watcher;

  @override
  Stream<List<Sparepart>> watchAll() => _watcher.watchAll();

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
  NestServiceRepository(SupabaseClient client, this._api)
      : _watcher = SupabaseCrudRepository<ServiceItem>(
          client,
          'services',
          ServiceItem.fromMap,
          (s) => s.toMap(),
        );

  final ApiClient _api;
  final SupabaseCrudRepository<ServiceItem> _watcher;

  @override
  Stream<List<ServiceItem>> watchAll() => _watcher.watchAll();

  @override
  Future<String> create(ServiceItem item) async {
    final json = await _api.post('/services', body: serviceToNestBody(item)) as Map;
    return json['id'] as String;
  }

  @override
  Future<void> update(String id, ServiceItem item) =>
      _api.patch('/services/$id', body: serviceToNestBody(item));
}
