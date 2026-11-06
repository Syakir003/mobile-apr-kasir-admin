import 'package:epos_ac/data/repositories/member_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fetchAllMemberRows menggabungkan semua halaman GET /members', () async {
    final asked = <String>[];
    Future<dynamic> get(String path) async {
      asked.add(path);
      final page = Uri.parse(path).queryParameters['page'];
      return {
        'items': [
          {'id': 'm$page'}
        ],
        'total': 2,
        'page': int.parse(page!),
        'pageSize': 100,
        'totalPages': 2,
      };
    }

    final rows = await fetchAllMemberRows(get);
    expect(rows.map((r) => r['id']), ['m1', 'm2']);
    expect(asked, ['/members?page=1&pageSize=100', '/members?page=2&pageSize=100']);
  });

  test('tanpa member: satu request, list kosong', () async {
    var calls = 0;
    final rows = await fetchAllMemberRows((_) async {
      calls++;
      return {'items': [], 'total': 0, 'page': 1, 'pageSize': 100, 'totalPages': 0};
    });
    expect(rows, isEmpty);
    expect(calls, 1);
  });
}
