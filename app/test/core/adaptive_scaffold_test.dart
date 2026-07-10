import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';
import 'package:epos_ac/data/models/app_user.dart';

void main() {
  group('destinationsForRole', () {
    test('admin melihat 7 destinasi termasuk Member dan Scan', () {
      final dests = destinationsForRole(UserRole.admin);
      expect(dests.length, 7);
      expect(dests.first.label, 'Dashboard');
      expect(dests.map((d) => d.route), [
        '/',
        '/products',
        '/spareparts',
        '/services',
        '/packages',
        '/members',
        '/scan',
      ]);
    });

    test('kasir hanya melihat Dashboard', () {
      final dests = destinationsForRole(UserRole.kasir);
      expect(dests.length, 1);
      expect(dests.single.route, '/');
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

    test('lokasi /products memilih Produk (1)', () {
      expect(selectedIndexFor(adminDests, '/products'), 1);
    });

    test('sub-route /spareparts/new memilih Sparepart (2)', () {
      expect(selectedIndexFor(adminDests, '/spareparts/new'), 2);
    });

    test('lokasi tak dikenal default ke 0', () {
      expect(selectedIndexFor(adminDests, '/unknown'), 0);
    });
  });
}
