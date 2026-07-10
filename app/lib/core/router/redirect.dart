import '../../data/models/app_user.dart';

/// Prefix lokasi yang hanya boleh diakses oleh admin
/// (modul master data + member). '/scan' cukup login (semua role).
const _adminOnlyPrefixes = [
  '/products',
  '/spareparts',
  '/services',
  '/packages',
  '/members',
];

String? computeRedirect({
  required AppUser? user,
  required UserRole? role,
  required bool loading,
  required String location,
}) {
  if (loading) return null;
  final loggedIn = user != null;
  final atLogin = location == '/login';
  if (!loggedIn) return atLogin ? null : '/login';
  if (atLogin) return '/';
  if (role != UserRole.admin && _isAdminOnly(location)) return '/';
  return null;
}

bool _isAdminOnly(String location) {
  for (final prefix in _adminOnlyPrefixes) {
    if (location == prefix || location.startsWith('$prefix/')) return true;
  }
  return false;
}
