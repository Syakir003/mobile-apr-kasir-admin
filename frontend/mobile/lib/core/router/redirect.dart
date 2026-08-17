import '../../data/models/app_user.dart';

/// Prefix lokasi yang hanya boleh diakses oleh admin
/// (modul master data + member). '/scan' cukup login (semua role).
const _adminOnlyPrefixes = [
  '/products',
  '/spareparts',
  '/services',
  '/packages',
  '/members',
  '/laporan',
  '/stok',
  '/users',
  '/audit',
  // Layar antrean '/pengingat' boleh kasir; hanya pengaturan siklus servisnya
  // yang admin-only, sesuai RPC `save_reminder_settings`.
  '/pengingat/pengaturan',
  // Kasir hanya menukar kode voucher lewat Checkout, bukan lewat layar ini.
  '/voucher',
];

/// Prefix lokasi POS, riwayat transaksi, & order service: boleh admin & kasir,
/// tapi TIDAK boleh teknisi. (Job teknisi `/jobs` sengaja tidak di sini —
/// dapat diakses semua role: teknisi melihat job miliknya, admin/kasir semua.)
const _kasirAdminPrefixes = [
  '/pos',
  '/transactions',
  '/orders',
  // Antrean pengingat memuat nama, nomor HP, dan alamat pelanggan — tertutup
  // dari teknisi, sama seperti RLS `wa_outbox` di migrasi 0023.
  '/pengingat',
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
