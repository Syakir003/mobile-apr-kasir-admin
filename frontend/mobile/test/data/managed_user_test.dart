import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/models/managed_user.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('memetakan baris users lengkap', () {
    final u = ManagedUser.fromMap('u1', {
      'email': 'budi@x.id',
      'display_name': 'Budi',
      'role': 'teknisi',
      'active': true,
      'created_at': '2026-07-19T02:00:00Z',
    });
    expect(u.id, 'u1');
    expect(u.role, UserRole.teknisi);
    expect(u.roleLabel, 'Teknisi');
    expect(u.label, 'Budi');
    expect(u.active, isTrue);
    expect(u.createdAt, isNotNull);
  });

  test('nama tampilan kosong jatuh ke bagian awal email', () {
    final u = ManagedUser.fromMap('u2', {
      'email': 'kasir.satu@x.id',
      'display_name': '',
      'role': 'kasir',
      'active': true,
    });
    expect(u.label, 'kasir.satu');
  });

  test('peran di luar enum tidak merusak baris', () {
    final u = ManagedUser.fromMap('u3', {
      'email': 'x@x.id',
      'role': 'superuser',
      'active': false,
    });
    expect(u.role, isNull);
    expect(u.roleLabel, 'Tidak dikenal');
    expect(u.active, isFalse);
  });

  test('active hilang dianggap nonaktif (aman secara default)', () {
    final u = ManagedUser.fromMap('u4', {'email': 'y@x.id', 'role': 'admin'});
    expect(u.active, isFalse);
  });
}
