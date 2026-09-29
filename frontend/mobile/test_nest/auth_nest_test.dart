// Test integrasi ke backend Nest SUNGGUHAN (bukan fake). Tidak ikut
// `flutter test` biasa — jalankan manual dengan backend lokal hidup:
//
//   flutter test test_nest --dart-define=NEST_API_URL=http://localhost:3100 \
//     --dart-define=TEST_EMAIL=... --dart-define=TEST_PASSWORD=...
//
// Pakai DB lokal/salinan, JANGAN produksi (test ini ganti password lalu
// mengembalikannya).
import 'package:epos_ac/core/api/api_client.dart';
import 'package:epos_ac/core/auth/session_store.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/repositories/auth_repository.dart';
import 'package:flutter_test/flutter_test.dart';

const _email = String.fromEnvironment('TEST_EMAIL');
const _password = String.fromEnvironment('TEST_PASSWORD');

void main() {
  late SessionStore session;
  late NestAuthRepository auth;

  setUp(() {
    session = SessionStore(MemoryKeyValueStore());
    SessionStore.instance = session;
    auth = NestAuthRepository(const ApiClient(), session);
  });

  test('login benar -> sesi tersimpan dengan role dari server', () async {
    await auth.signIn(email: _email, password: _password);
    expect(session.token, isNotEmpty);
    expect(session.user, isNotNull);
    expect(UserRole.values, contains(session.user!.role));
  });

  test('login salah -> 401 dan sesi tetap kosong', () async {
    await expectLater(
      auth.signIn(email: _email, password: 'salah-banget-123'),
      throwsA(isA<NestApiException>().having((e) => e.statusCode, 'status', 401)),
    );
    expect(session.token, isNull);
  });

  test('refresh (/auth/me) memperbarui profil tanpa ganti token', () async {
    await auth.signIn(email: _email, password: _password);
    final token = session.token;
    await auth.refresh();
    expect(session.token, token);
    expect(session.user, isNotNull);
  });

  test('token rusak -> request 401 menghapus sesi (auto logout)', () async {
    await auth.signIn(email: _email, password: _password);
    await session.save('token-rusak', session.user!);
    await expectLater(const ApiClient().get('/auth/me'), throwsA(isA<NestApiException>()));
    expect(session.token, isNull);
  });

  test('ganti password -> token baru tersimpan & tetap login, lalu dikembalikan', () async {
    await auth.signIn(email: _email, password: _password);
    final oldToken = session.token;
    const temp = 'sementara123';
    await auth.changePassword(currentPassword: _password, newPassword: temp);
    expect(session.token, isNot(oldToken));
    // token baru harus diterima server (bukan kelempar ke login)
    await auth.refresh();
    expect(session.token, isNotNull);
    await auth.changePassword(currentPassword: temp, newPassword: _password);
    await auth.signIn(email: _email, password: _password);
    expect(session.token, isNotNull);
  });
}
