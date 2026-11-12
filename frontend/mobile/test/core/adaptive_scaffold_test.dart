import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';
import 'package:epos_ac/data/models/app_user.dart';

void main() {
  group('destinationsForRole', () {
    test(
        'admin melihat 21 destinasi termasuk Pengajuan, Pengingat, Voucher, Undian, '
        'Stok, Keluar Gudang, Laporan, Akun, & Audit', () {
      final dests = destinationsForRole(UserRole.admin);
      expect(dests.length, 21);
      expect(dests.first.label, 'Dashboard');
      expect(dests.map((d) => d.route), [
        '/',
        '/pos',
        '/transactions',
        '/products',
        '/spareparts',
        '/services',
        '/packages',
        '/members',
        '/orders',
        '/jobs',
        '/pengajuan',
        '/pengingat',
        '/voucher',
        '/undian',
        '/stok',
        '/keluar-gudang',
        '/laporan',
        '/users',
        '/audit',
        '/scan',
        '/profile',
      ]);
      expect(dests.map((d) => d.label), contains('Stok'));
      expect(dests.map((d) => d.label), contains('Laporan'));
      expect(dests.map((d) => d.label), contains('Akun'));
      expect(dests.map((d) => d.label), contains('Audit'));
      expect(dests.map((d) => d.label), contains('Pengingat'));
      expect(dests.map((d) => d.label), contains('Voucher'));
      expect(dests.map((d) => d.label), contains('Undian'));
    });

    test('kasir melihat Dashboard, Transaksi, Riwayat, Order, Pengingat, Profil',
        () {
      final dests = destinationsForRole(UserRole.kasir);
      expect(dests.length, 6);
      expect(dests.map((d) => d.route),
          ['/', '/pos', '/transactions', '/orders', '/pengingat', '/profile']);
    });

    test('teknisi tidak melihat Pengingat (data pelanggan tertutup)', () {
      final dests = destinationsForRole(UserRole.teknisi);
      expect(dests.map((d) => d.route), isNot(contains('/pengingat')));
    });

    test('teknisi melihat Dashboard, Job, Riwayat, Scan, Profil', () {
      final dests = destinationsForRole(UserRole.teknisi);
      expect(dests.length, 5);
      expect(dests.map((d) => d.route), ['/', '/jobs', '/riwayat', '/scan', '/profile']);
    });

    test('gudang melihat Dashboard, Produk, Sparepart, Stok, Keluar Gudang, Profil',
        () {
      final dests = destinationsForRole(UserRole.gudang);
      expect(dests.map((d) => d.route), [
        '/',
        '/products',
        '/spareparts',
        '/stok',
        '/keluar-gudang',
        '/profile',
      ]);
    });

    test('Keluar Gudang hanya untuk admin & gudang', () {
      for (final role in [UserRole.admin, UserRole.gudang]) {
        expect(destinationsForRole(role).map((d) => d.route),
            contains('/keluar-gudang'));
      }
      for (final role in [UserRole.kasir, UserRole.teknisi]) {
        expect(destinationsForRole(role).map((d) => d.route),
            isNot(contains('/keluar-gudang')));
      }
    });

    test('null (belum ada role) hanya melihat Dashboard', () {
      expect(destinationsForRole(null).length, 1);
    });
  });

  group('selectedIndexFor', () {
    final adminDests = destinationsForRole(UserRole.admin);

    test('lokasi / memilih Dashboard (0)', () {
      expect(selectedIndexFor(adminDests, '/'), 0);
    });

    test('lokasi /pos memilih Transaksi (1)', () {
      expect(selectedIndexFor(adminDests, '/pos'), 1);
    });

    test('sub-route /pos/checkout memilih Transaksi (1)', () {
      expect(selectedIndexFor(adminDests, '/pos/checkout'), 1);
    });

    test('sub-route /transactions/abc memilih Riwayat (2)', () {
      expect(selectedIndexFor(adminDests, '/transactions/abc'), 2);
    });

    test('lokasi /products memilih Produk (3)', () {
      expect(selectedIndexFor(adminDests, '/products'), 3);
    });

    test('sub-route /spareparts/new memilih Sparepart (4)', () {
      expect(selectedIndexFor(adminDests, '/spareparts/new'), 4);
    });

    test('lokasi tak dikenal default ke 0', () {
      expect(selectedIndexFor(adminDests, '/unknown'), 0);
    });
  });
}
