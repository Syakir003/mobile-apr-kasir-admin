import '../../core/api/api_client.dart';
import '../../core/utils/snake_keys.dart';
import '../models/installation_package.dart';
import 'crud_repository.dart';

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

/// [CrudRepository] paket instalasi lewat backend NestJS.
/// `POST /installation-packages` (create) & `PATCH /installation-packages/:id`
/// (update) sama-sama full-replace item dalam SATU transaksi Prisma.
/// [watchAll] = sekali GET `?status=all`; form simpan me-`ref.invalidate` daftarnya.
class NestPackageRepository implements CrudRepository<InstallationPackage> {
  const NestPackageRepository(this._api);

  final ApiClient _api;

  @override
  Stream<List<InstallationPackage>> watchAll() async* {
    final rows = await _api.get('/installation-packages?status=all') as List;
    yield [
      for (final r in rows)
        InstallationPackage.fromMap((r as Map)['id'] as String, {
          ...snakeKeys(r),
          'items': [for (final i in (r['items'] as List? ?? const [])) snakeKeys(i as Map)],
        }),
    ];
  }

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
