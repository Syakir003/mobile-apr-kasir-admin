import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/router/redirect.dart';
import 'package:epos_ac/data/models/app_user.dart';

const kasir = AppUser(uid: 'u', email: 'e', displayName: 'd', role: UserRole.kasir);

void main() {
  test('belum login diarahkan ke /login', () {
    expect(computeRedirect(user: null, loading: false, location: '/'), '/login');
  });
  test('belum login boleh tetap di /login', () {
    expect(computeRedirect(user: null, loading: false, location: '/login'), isNull);
  });
  test('sudah login tidak boleh di /login', () {
    expect(computeRedirect(user: kasir, loading: false, location: '/login'), '/');
  });
  test('saat auth masih loading, jangan redirect', () {
    expect(computeRedirect(user: null, loading: true, location: '/'), isNull);
  });
  test('sudah login di halaman lain: tidak redirect', () {
    expect(computeRedirect(user: kasir, loading: false, location: '/'), isNull);
  });
}
