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

/// Prefix lokasi POS & riwayat transaksi: boleh admin & kasir, tapi TIDAK
/// boleh teknisi.
const _kasirAdminPrefixes = [
  '/pos',
  '/transactions',
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
  if (role != UserRole.admin && _hasPrefix(location, _adminOnlyPrefixes)) {
    return '/';
  }
  if (role == UserRole.teknisi && _hasPrefix(location, _kasirAdminPrefixes)) {
    return '/';
  }
  return null;
}

bool _hasPrefix(String location, List<String> prefixes) {
  for (final prefix in prefixes) {
    if (location == prefix || location.startsWith('$prefix/')) return true;
  }
  return false;
}
