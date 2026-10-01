import '../../core/api/api_client.dart';
import '../../core/utils/snake_keys.dart';
import '../models/member.dart';
import 'crud_repository.dart';

/// [CrudRepository] member lewat backend Nest (`/members`). Daftar dimuat
/// sekali per pembacaan (backend tidak punya event realtime untuk member);
/// pemanggil me-refetch lewat `ref.invalidate(membersStreamProvider)`.
class NestMemberRepository implements CrudRepository<Member> {
  const NestMemberRepository(this._api);

  final ApiClient _api;

  static const _customerTypes = {'rumah', 'perusahaan', 'toko'};

  @override
  Stream<List<Member>> watchAll() async* {
    final rows = await _api.get('/members') as List;
    yield [
      for (final r in rows) Member.fromMap((r as Map)['id'] as String, snakeKeys(r)),
    ];
  }

  /// Body Create/UpdateMemberDto. 'lainnya' (tipe lama) tidak ada di enum
  /// backend, jadi tidak dikirim.
  Map<String, dynamic> _body(Member m) => {
        'name': m.name,
        'phone': m.phone,
        'address': m.address,
        if (_customerTypes.contains(m.customerType)) 'customerType': m.customerType,
        'notes': m.notes ?? '',
      };

  @override
  Future<String> create(Member item) async {
    final res = await _api.post('/members', body: _body(item)) as Map;
    if (res['status'] == 'confirm_required') {
      final ex = res['existingMember'] as Map;
      throw Exception('Nomor HP sudah terdaftar atas nama ${ex['name']}.');
    }
    return (res['member'] as Map)['id'] as String;
  }

  @override
  Future<void> update(String id, Member item) async {
    await _api.patch('/members/$id', body: {..._body(item), 'active': item.active});
  }
}
