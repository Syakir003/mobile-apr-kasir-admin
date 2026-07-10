import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/router/redirect.dart';
import 'package:epos_ac/data/models/app_user.dart';

const kasir = AppUser(uid: 'u', email: 'e', displayName: 'd', role: UserRole.kasir);
const admin = AppUser(uid: 'a', email: 'e', displayName: 'd', role: UserRole.admin);

void main() {
  test('belum login diarahkan ke /login', () {
    expect(
      computeRedirect(user: null, role: null, loading: false, location: '/'),
      '/login',
    );
  });
  test('belum login boleh tetap di /login', () {
    expect(
      computeRedirect(user: null, role: null, loading: false, location: '/login'),
      isNull,
    );
  });
  test('sudah login tidak boleh di /login', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/login',
      ),
      '/',
    );
  });
  test('saat auth masih loading, jangan redirect', () {
    expect(
      computeRedirect(user: null, role: null, loading: true, location: '/'),
      isNull,
    );
  });
  test('sudah login di halaman lain: tidak redirect', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/',
      ),
      isNull,
    );
  });

  test('kasir buka /products diarahkan ke /', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/products',
      ),
      '/',
    );
  });
  test('kasir buka sub-route master juga diarahkan ke /', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/spareparts/new',
      ),
      '/',
    );
  });
  test('admin buka /products tidak di-redirect', () {
    expect(
      computeRedirect(
        user: admin,
        role: UserRole.admin,
        loading: false,
        location: '/products',
      ),
      isNull,
    );
  });
  test('kasir buka /members diarahkan ke /', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/members',
      ),
      '/',
    );
  });
  test('teknisi buka /scan tidak di-redirect', () {
    const teknisi =
        AppUser(uid: 't', email: 'e', displayName: 'd', role: UserRole.teknisi);
    expect(
      computeRedirect(
        user: teknisi,
        role: UserRole.teknisi,
        loading: false,
        location: '/scan',
      ),
      isNull,
    );
  });
  test('admin buka semua modul master tidak di-redirect', () {
    for (final loc in [
      '/products',
      '/spareparts',
      '/services',
      '/packages',
      '/members',
    ]) {
      expect(
        computeRedirect(
          user: admin,
          role: UserRole.admin,
          loading: false,
          location: loc,
        ),
        isNull,
        reason: 'admin harus boleh membuka $loc',
      );
    }
  });
}
