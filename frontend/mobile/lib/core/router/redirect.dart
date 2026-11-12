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
  // Memutuskan pengajuan material: admin saja (sama dengan backend PATCH /material-requests/:id/decide).
  '/pengajuan',
  '/koreksi-unit',
  '/data-lampau',
  // Layar antrean '/pengingat' boleh kasir; hanya pengaturan siklus servisnya
  // yang admin-only, sesuai RPC `save_reminder_settings`.
  '/pengingat/pengaturan',
  // Kasir hanya menukar kode voucher lewat Checkout, bukan lewat layar ini.
  '/voucher',
  '/undian',
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

/// Gudang (staf stok) hanya boleh melihat daftar Produk & Sparepart (tanpa
/// tambah/ubah — admin-only di backend), Stok & mutasinya, notifikasi, profil.
/// Daftar putih, bukan daftar tolak, supaya layar baru tidak otomatis terbuka.
const _gudangExact = ['/', '/products', '/spareparts', '/notifications', '/profile'];
const _gudangPrefixes = ['/stok', '/keluar-gudang'];

/// Keluar Gudang (scan) — admin & gudang saja, sama seperti backend
/// `/kasir-scan`. Kasir cukup checkout; teknisi tidak ada urusan di sini.
const _adminGudangPrefixes = ['/keluar-gudang'];

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
  if (role == UserRole.gudang) {
    final ok =
        _gudangExact.contains(location) || _hasPrefix(location, _gudangPrefixes);
    return ok ? null : '/';
  }
  if (role != UserRole.admin && _hasPrefix(location, _adminOnlyPrefixes)) {
    return '/';
  }
  // Gudang sudah ditangani di atas (daftar putih); di sini sisa peran lain.
  if (role != UserRole.admin && _hasPrefix(location, _adminGudangPrefixes)) {
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
