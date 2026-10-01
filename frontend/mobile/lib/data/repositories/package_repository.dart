import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api/api_client.dart';
import '../models/installation_package.dart';
import 'crud_repository.dart';

/// CRUD paket instalasi: parent `installation_packages` + anak
/// `installation_package_items` (dulu array `items[]` dalam satu dokumen
/// Firestore). Tulis lewat RPC `save_installation_package` supaya parent dan
/// item tersimpan dalam SATU transaksi.
class SupabasePackageRepository implements CrudRepository<InstallationPackage> {
  SupabasePackageRepository(this._client);

  final SupabaseClient _client;

  @override
  Stream<List<InstallationPackage>> watchAll() {
    // Stream Realtime tidak mendukung join → tiap perubahan pada tabel parent
    // memicu select ulang lengkap dengan item (alias `items`). Semua edit
    // lewat RPC selalu menyentuh parent, jadi perubahan item ikut terpantau.
    return _client
        .from('installation_packages')
        .stream(primaryKey: ['id'])
        .asyncMap((_) async {
          final rows = await _client
              .from('installation_packages')
              .select('*, items:installation_package_items(*)')
              .order('name', ascending: true);
          return rows
              .map((row) => InstallationPackage.fromMap(
                    row['id'] as String,
                    row,
                  ))
              .toList(growable: false);
        });
  }

  @override
  Future<String> create(InstallationPackage item) => _save(null, item);

  @override
  Future<void> update(String id, InstallationPackage item) => _save(id, item);

  Future<String> _save(String? id, InstallationPackage item) async {
    final result = await _client.rpc('save_installation_package', params: {
      'p_id': id,
      'p_name': item.name,
      'p_description': item.description,
      'p_active': item.active,
      'p_items':
          item.items.map((e) => e.toMap()).toList(growable: false),
    });
    return result as String;
  }
}

/// Body camelCase untuk `POST/PATCH /installation-packages` — Nest.
/// `PackageItem` sudah camelCase persis sama dengan
/// `InstallationPackageItemDto` (`sparepartId`, `extraPricePerUnit`, dst),
/// beda dengan `PackageItem.toMap()` yang snake_case (khusus RPC Supabase).
Map<String, dynamic> installationPackageToNestBody(InstallationPackage p) => {
      'name': p.name,
      'description': p.description,
      'active': p.active,
      'items': p.items
          .map((e) => {
                'sparepartId': e.sparepartId,
                'name': e.name,
                'qty': e.qty,
                'unit': e.unit,
                'extraPricePerUnit': e.extraPricePerUnit,
              })
          .toList(growable: false),
    };

/// Implementasi [CrudRepository] paket instalasi lewat backend NestJS —
/// pengganti [SupabasePackageRepository] pada migrasi Flutter -> Nest.
/// `POST /installation-packages` (create) & `PATCH /installation-packages/:id`
/// (update) sama-sama full-replace item dalam SATU transaksi Prisma, port 1:1
/// dari RPC `save_installation_package` (lihat
/// `installation-packages.service.ts`) — jadi semantiknya tetap sama.
///
/// [watchAll] TETAP lewat Supabase Realtime (delegasi ke
/// [SupabasePackageRepository] internal) — realtime belum dipindah ke Nest.
class NestPackageRepository implements CrudRepository<InstallationPackage> {
  NestPackageRepository(SupabaseClient client, this._api)
      : _watcher = SupabasePackageRepository(client);

  final ApiClient _api;
  final SupabasePackageRepository _watcher;

  @override
  Stream<List<InstallationPackage>> watchAll() => _watcher.watchAll();

  @override
  Future<String> create(InstallationPackage item) async {
    final json = await _api.post(
      '/installation-packages',
      body: installationPackageToNestBody(item),
    ) as Map;
    return json['id'] as String;
  }

  @override
  Future<void> update(String id, InstallationPackage item) => _api.patch(
        '/installation-packages/$id',
        body: installationPackageToNestBody(item),
      );
}
