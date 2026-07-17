import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';
import 'package:epos_ac/data/models/app_user.dart';

void main() {
  group('destinationsForRole', () {
    test('admin melihat 13 destinasi termasuk Order, Job, & Laporan', () {
      final dests = destinationsForRole(UserRole.admin);
      expect(dests.length, 13);
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
        '/laporan',
        '/scan',
        '/profile',
      ]);
      expect(dests.map((d) => d.label), contains('Order'));
      expect(dests.map((d) => d.label), contains('Laporan'));
    });

    test('kasir melihat Dashboard, Transaksi, Riwayat, Order, Profil', () {
      final dests = destinationsForRole(UserRole.kasir);
      expect(dests.length, 5);
      expect(dests.map((d) => d.route),
          ['/', '/pos', '/transactions', '/orders', '/profile']);
    });

    test('teknisi melihat Dashboard, Job, Scan, Profil', () {
      final dests = destinationsForRole(UserRole.teknisi);
      expect(dests.length, 4);
      expect(dests.map((d) => d.route), ['/', '/jobs', '/scan', '/profile']);
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
