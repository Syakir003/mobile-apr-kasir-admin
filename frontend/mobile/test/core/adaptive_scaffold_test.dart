import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';
import 'package:epos_ac/data/models/app_user.dart';

void main() {
  test('nama menu sama dengan web (nav-config.ts)', () {
    String label(UserRole r, String route) =>
        destinationsForRole(r).firstWhere((d) => d.route == route).label;
    expect(label(UserRole.admin, '/pos'), 'Kasir (POS)');
    expect(label(UserRole.admin, '/transactions'), 'Riwayat Transaksi');
    expect(label(UserRole.admin, '/jobs'), 'Antrian Servis');
    expect(label(UserRole.admin, '/products'), 'Produk AC');
    expect(label(UserRole.admin, '/packages'), 'Paket Instalasi');
    expect(label(UserRole.admin, '/pengajuan'), 'Permintaan Material');
    // Web tidak punya daftar order: menunya langsung form Terima Servis.
    expect(label(UserRole.admin, '/orders/new'), 'Terima Servis Baru');
    expect(label(UserRole.teknisi, '/jobs'), 'Job Saya');
    expect(label(UserRole.teknisi, '/scan'), 'Scan Unit');
    expect(label(UserRole.gudang, '/keluar-gudang'), 'Keluar Gudang (Scan)');
  });

  test('barLabel: bottom bar memakai label ringkas satu baris, nama lain tak berubah', () {
    expect(barLabel('Kasir (POS)'), 'Kasir');
    expect(barLabel('Riwayat Transaksi'), 'Riwayat');
    expect(barLabel('Terima Servis Baru'), 'Servis Baru');
    expect(barLabel('Dashboard'), 'Dashboard');
  });

  group('menuSectionsFor', () {
    test('admin: grup ala web memuat setiap destinasi tepat satu kali', () {
      final sections = menuSectionsFor(UserRole.admin);
      final routes = [for (final s in sections) for (final d in s.items) d.route];
      expect(routes.toSet(),
          destinationsForRole(UserRole.admin).map((d) => d.route).toSet());
      expect(routes.length, routes.toSet().length);
      expect(
        sections.where((s) => s.label != null).map((s) => s.label),
        ['Penjualan', 'Servis AC', 'Pelanggan', 'Stok & Gudang', 'Data Master', 'Pengaturan'],
      );
    });

    test('role lain tetap datar tanpa grup', () {
      for (final role in [UserRole.kasir, UserRole.teknisi, UserRole.gudang]) {
        final sections = menuSectionsFor(role);
        expect(sections.length, 1);
        expect(sections.single.label, isNull);
      }
    });
  });

  group('destinationsForRole', () {
    test(
        'admin melihat 23 destinasi termasuk Pengajuan, Pengingat, Voucher, Undian, '
        'Stok, Keluar Gudang, Laporan, Akun, & Audit', () {
      final dests = destinationsForRole(UserRole.admin);
      expect(dests.length, 23);
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
        '/orders/new',
        '/jobs',
        '/pengajuan',
        '/koreksi-unit',
        '/data-lampau',
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
      expect(dests.map((d) => d.label), contains('Pengguna'));
      expect(dests.map((d) => d.label), contains('Log Audit'));
      expect(dests.map((d) => d.label), contains('Pengingat WA'));
      expect(dests.map((d) => d.label), contains('Voucher'));
      expect(dests.map((d) => d.label), contains('Undian'));
    });

    test('kasir melihat Dashboard, Transaksi, Riwayat, Order, Pengingat, Profil',
        () {
      final dests = destinationsForRole(UserRole.kasir);
      expect(dests.length, 6);
      expect(dests.map((d) => d.route),
          ['/', '/pos', '/transactions', '/orders/new', '/pengingat', '/profile']);
    });

    test('teknisi tidak melihat Pengingat (data pelanggan tertutup)', () {
      final dests = destinationsForRole(UserRole.teknisi);
      expect(dests.map((d) => d.route), isNot(contains('/pengingat')));
    });

    test('teknisi melihat Dashboard, Job Saya, Scan Unit, Riwayat, Profil', () {
      final dests = destinationsForRole(UserRole.teknisi);
      expect(dests.length, 5);
      expect(dests.map((d) => d.route), ['/', '/jobs', '/scan', '/riwayat', '/profile']);
    });

    test(
        'gudang melihat Dashboard, Produk, Sparepart, Stok, Keluar Gudang, Laporan Stok, Profil',
        () {
      final dests = destinationsForRole(UserRole.gudang);
      expect(dests.map((d) => d.route), [
        '/',
        '/products',
        '/spareparts',
        '/stok',
        '/keluar-gudang',
        '/stok/laporan',
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
