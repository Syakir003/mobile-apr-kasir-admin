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
  test('kasir buka /users diarahkan ke / (manajemen akun admin-only)', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/users',
      ),
      '/',
    );
  });
  test('kasir buka form akun juga diarahkan ke /', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/users/new',
      ),
      '/',
    );
  });
  test('admin buka /users tidak di-redirect', () {
    expect(
      computeRedirect(
        user: admin,
        role: UserRole.admin,
        loading: false,
        location: '/users',
      ),
      isNull,
    );
  });
  test('kasir buka /audit diarahkan ke /', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/audit',
      ),
      '/',
    );
  });
  test('admin buka /audit tidak di-redirect', () {
    expect(
      computeRedirect(
        user: admin,
        role: UserRole.admin,
        loading: false,
        location: '/audit',
      ),
      isNull,
    );
  });
  test('admin buka /stok/adjust tidak di-redirect', () {
    expect(
      computeRedirect(
        user: admin,
        role: UserRole.admin,
        loading: false,
        location: '/stok/adjust',
      ),
      isNull,
    );
  });
  test('kasir buka /stok/adjust diarahkan ke /', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/stok/adjust',
      ),
      '/',
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

  test('teknisi buka riwayat unit tidak di-redirect', () {
    const teknisi =
        AppUser(uid: 't', email: 'e', displayName: 'd', role: UserRole.teknisi);
    expect(
      computeRedirect(
        user: teknisi,
        role: UserRole.teknisi,
        loading: false,
        location: '/units/u1/history',
      ),
      isNull,
    );
  });

  const teknisi =
      AppUser(uid: 't', email: 'e', displayName: 'd', role: UserRole.teknisi);

  test('kasir buka /pos tidak di-redirect', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/pos',
      ),
      isNull,
    );
  });
  test('teknisi buka /pos diarahkan ke /', () {
    expect(
      computeRedirect(
        user: teknisi,
        role: UserRole.teknisi,
        loading: false,
        location: '/pos',
      ),
      '/',
    );
  });
  test('kasir buka detail transaksi tidak di-redirect', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/transactions/abc',
      ),
      isNull,
    );
  });
  test('teknisi buka /transactions diarahkan ke /', () {
    expect(
      computeRedirect(
        user: teknisi,
        role: UserRole.teknisi,
        loading: false,
        location: '/transactions',
      ),
      '/',
    );
  });
  test('teknisi buka /orders diarahkan ke /', () {
    expect(
      computeRedirect(
        user: teknisi,
        role: UserRole.teknisi,
        loading: false,
        location: '/orders',
      ),
      '/',
    );
  });
  test('kasir buka /orders tidak di-redirect', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/orders',
      ),
      isNull,
    );
  });
  test('teknisi buka /jobs (job miliknya) tidak di-redirect', () {
    expect(
      computeRedirect(
        user: teknisi,
        role: UserRole.teknisi,
        loading: false,
        location: '/jobs',
      ),
      isNull,
    );
  });
  test('admin buka /jobs tidak di-redirect', () {
    expect(
      computeRedirect(
        user: admin,
        role: UserRole.admin,
        loading: false,
        location: '/jobs',
      ),
      isNull,
    );
  });
  test('kasir buka /laporan diarahkan ke / (khusus admin)', () {
    expect(
      computeRedirect(
        user: kasir,
        role: UserRole.kasir,
        loading: false,
        location: '/laporan',
      ),
      '/',
    );
  });
  test('admin buka semua modul master tidak di-redirect', () {
    for (final loc in [
      '/products',
      '/spareparts',
      '/services',
      '/packages',
      '/members',
      '/laporan',
      '/stok',
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
