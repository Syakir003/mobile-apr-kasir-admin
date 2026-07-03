import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/app_user.dart';

void main() {
  test('UserRole.fromClaim memetakan string ke enum', () {
    expect(UserRole.fromClaim('admin'), UserRole.admin);
    expect(UserRole.fromClaim('kasir'), UserRole.kasir);
    expect(UserRole.fromClaim('teknisi'), UserRole.teknisi);
    expect(UserRole.fromClaim('lainnya'), isNull);
    expect(UserRole.fromClaim(null), isNull);
  });

  test('AppUser menyimpan identitas dasar', () {
    const u = AppUser(uid: 'u1', email: 'a@b.c', displayName: 'Ana', role: UserRole.kasir);
    expect(u.role, UserRole.kasir);
    expect(u.uid, 'u1');
  });
}
