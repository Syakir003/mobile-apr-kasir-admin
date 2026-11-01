enum UserRole {
  admin,
  kasir,
  teknisi,
  gudang;

  static UserRole? fromClaim(Object? claim) => switch (claim) {
        'admin' => UserRole.admin,
        'kasir' => UserRole.kasir,
        'teknisi' => UserRole.teknisi,
        'gudang' => UserRole.gudang,
        _ => null,
      };
}

class AppUser {
  const AppUser({
    required this.uid,
    required this.email,
    required this.displayName,
    required this.role,
  });

  final String uid;
  final String email;
  final String displayName;
  final UserRole role;
}
