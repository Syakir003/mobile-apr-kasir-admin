// Test integrasi login ke backend Nest SUNGGUHAN. Jalankan (DB lokal/salinan,
// JANGAN produksi — test ini ganti password lalu mengembalikannya):
//   flutter test test_nest --concurrency=1
//     --dart-define=NEST_API_URL=http://localhost:3100
//     --dart-define=ADMIN_EMAIL=.. --dart-define=KASIR_EMAIL=.. --dart-define=TEKNISI_EMAIL=..
// --concurrency=1 WAJIB: file ini ganti password teknisi, file lain login
// sebagai teknisi di saat yang sama kalau dijalankan paralel.
import 'package:epos_ac/core/api/api_client.dart';
import 'package:epos_ac/core/auth/session_store.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/repositories/auth_repository.dart';
import 'package:flutter_test/flutter_test.dart';

import '_support.dart';

// Akun kasir: kuota login per email (10/menit) terpisah dari teknisi yang
// dipakai file test lain.
final _email = emailFor('kasir');
const _password = testPassword;

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
    const temp = 'sementara123';
    await auth.changePassword(currentPassword: _password, newPassword: temp);
    try {
      // Token dari respons ganti password harus DITERIMA server. (Bisa sama
      // persis dengan token lama kalau terbit di detik yang sama — iat detik.)
      await const ApiClient().get('/auth/me');
      expect(session.token, isNotNull);
    } finally {
      // Selalu kembalikan password, walau asersi di atas gagal — kalau gak,
      // test lain yang login sebagai teknisi ikut gagal.
      await auth.changePassword(currentPassword: temp, newPassword: _password);
    }
    await auth.signIn(email: _email, password: _password);
    expect(session.token, isNotNull);
  });
}
