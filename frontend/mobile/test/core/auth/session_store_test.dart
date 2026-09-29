import 'package:epos_ac/core/auth/session_store.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/repositories/auth_repository.dart';
import 'package:flutter_test/flutter_test.dart';

const _user = AppUser(uid: 'u1', email: 'a@b.id', displayName: 'Andi', role: UserRole.teknisi);

void main() {
  group('SessionStore', () {
    test('save -> load di instance baru mengembalikan token & user yang sama', () async {
      final storage = MemoryKeyValueStore();
      await SessionStore(storage).save('tok-1', _user);

      final reloaded = SessionStore(storage);
      await reloaded.load();
      expect(reloaded.token, 'tok-1');
      expect(reloaded.user?.uid, 'u1');
      expect(reloaded.user?.role, UserRole.teknisi);
    });

    test('clear menghapus sesi & memancarkan null', () async {
      final store = SessionStore(MemoryKeyValueStore());
      await store.save('tok-1', _user);
      final emitted = <AppUser?>[];
      final sub = store.changes.listen(emitted.add);
      await store.clear();
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();
      expect(store.token, isNull);
      expect(emitted, [null]);
    });

    test('data tersimpan rusak dianggap belum login', () async {
      final storage = MemoryKeyValueStore();
      await storage.write('epos_session_v1', '{bukan json');
      final store = SessionStore(storage);
      await store.load();
      expect(store.token, isNull);
      expect(await storage.read('epos_session_v1'), isNull);
    });
  });

  group('userFromJson (bentuk user dari /auth/login & /auth/me Nest)', () {
    test('memetakan id/role/displayName', () {
      final u = userFromJson({'id': 'x', 'email': 'e@x.id', 'role': 'kasir', 'displayName': 'Dewi'});
      expect(u?.uid, 'x');
      expect(u?.role, UserRole.kasir);
      expect(u?.displayName, 'Dewi');
    });
    test('role tak dikenal / id kosong = null (gak boleh masuk)', () {
      expect(userFromJson({'id': 'x', 'role': 'superadmin'}), isNull);
      expect(userFromJson({'id': '', 'role': 'admin'}), isNull);
      expect(userFromJson('bukan map'), isNull);
    });
  });

  group('validateStrongPassword (sama dengan IsStrongPassword backend)', () {
    test('valid: >= 8 karakter, ada huruf & angka', () {
      expect(validateStrongPassword('rahasia1'), isNull);
    });
    test('ditolak: pendek / tanpa angka / tanpa huruf', () {
      expect(validateStrongPassword('abc12'), 'Password minimal 8 karakter');
      expect(validateStrongPassword('rahasiasaja'), 'Password wajib kombinasi huruf dan angka');
      expect(validateStrongPassword('12345678'), 'Password wajib kombinasi huruf dan angka');
    });
  });
}
