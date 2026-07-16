import 'package:supabase_flutter/supabase_flutter.dart';

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
