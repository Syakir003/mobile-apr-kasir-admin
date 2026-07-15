import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';
import 'package:epos_ac/data/models/app_user.dart';

void main() {
  group('destinationsForRole', () {
    test('admin melihat 9 destinasi termasuk Transaksi, Riwayat, Member', () {
      final dests = destinationsForRole(UserRole.admin);
      expect(dests.length, 9);
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
        '/scan',
      ]);
      expect(dests.map((d) => d.label), contains('Transaksi'));
      expect(dests.map((d) => d.label), contains('Riwayat'));
    });

    test('kasir melihat Dashboard, Transaksi, Riwayat', () {
      final dests = destinationsForRole(UserRole.kasir);
      expect(dests.length, 3);
      expect(dests.map((d) => d.route), ['/', '/pos', '/transactions']);
    });

    test('teknisi melihat Dashboard dan Scan', () {
      final dests = destinationsForRole(UserRole.teknisi);
      expect(dests.length, 2);
      expect(dests.map((d) => d.route), ['/', '/scan']);
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
