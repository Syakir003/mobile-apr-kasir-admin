import 'app_user.dart';

/// Satu baris `public.users` dilihat dari layar manajemen akun.
///
/// Berbeda dari [AppUser] yang merepresentasikan sesi yang SEDANG login
/// (peran dibaca dari klaim JWT): di sini peran & status aktif dibaca dari
/// tabel, dan `active` ikut dibawa karena admin perlu menonaktifkan akun.
class ManagedUser {
  const ManagedUser({
    required this.id,
    required this.email,
    required this.displayName,
    required this.role,
    required this.active,
    this.createdAt,
  });

  final String id;
  final String email;
  final String displayName;

  /// Null bila nilai kolom di luar enum yang dikenal (tidak seharusnya terjadi
  /// — kolom bertipe enum `user_role` — tapi jangan sampai satu baris aneh
  /// merusak seluruh daftar).
  final UserRole? role;
  final bool active;
  final DateTime? createdAt;

  /// Nama untuk ditampilkan; jatuh ke bagian awal email bila kosong.
  String get label =>
      displayName.isNotEmpty ? displayName : email.split('@').first;

  String get roleLabel => switch (role) {
        UserRole.admin => 'Admin',
        UserRole.kasir => 'Kasir',
        UserRole.teknisi => 'Teknisi',
        null => 'Tidak dikenal',
      };

  factory ManagedUser.fromMap(String id, Map<String, dynamic> data) {
    return ManagedUser(
      id: id,
      email: (data['email'] as String?) ?? '',
      displayName: (data['display_name'] as String?) ?? '',
      role: UserRole.fromClaim(data['role']),
      active: (data['active'] as bool?) ?? false,
      createdAt: DateTime.tryParse('${data['created_at']}')?.toLocal(),
    );
  }
}
