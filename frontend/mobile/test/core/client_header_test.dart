import 'package:epos_ac/core/api/api_client.dart';
import 'package:epos_ac/core/auth/session_store.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// Server memberi sesi 7 hari hanya bila permintaan menandai dirinya dari HP.
void main() {
  test('login & ganti password mengirim penanda aplikasi HP', () async {
    final previous = SessionStore.instance;
    addTearDown(() => SessionStore.instance = previous);
    SessionStore.instance = SessionStore(MemoryKeyValueStore());
    await SessionStore.instance
        .save('t', const AppUser(uid: 'u', email: 'e', displayName: 'U', role: UserRole.teknisi));
    final seen = <String?>[];
    await http.runWithClient(() async {
      const api = ApiClient('http://x');
      await api.postPublic('/auth/login', body: {});
      await api.patch('/auth/me/password', body: {});
    }, () => MockClient((request) async {
          seen.add(request.headers['X-Epos-Client']);
          return http.Response('{}', 200);
        }));
    expect(seen, ['mobile', 'mobile']);
  });
}
