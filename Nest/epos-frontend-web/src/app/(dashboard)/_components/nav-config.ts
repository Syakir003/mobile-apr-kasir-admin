import type { Role } from '@/lib/session';

export interface NavItem {
  href: string;
  label: string;
}

// Menu per role — SATU shell dipakai buat semua role (bukan folder
// per-role), nav-nya aja yang difilter. Konsisten sama keputusan arsitektur
// di plan/2026-08-23-rencana-frontend-nextjs.md §route groups.
export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/pos', label: 'Kasir (POS)' },
    { href: '/invoices', label: 'Riwayat Transaksi' },
    { href: '/teknisi/queue', label: 'Servis & Teknisi' },
    { href: '/service-orders/intake', label: 'Servis Mandiri' },
    { href: '/members', label: 'Member' },
    { href: '/master', label: 'Master Data' },
    // Voucher (campaign diskon buat member) SENGAJA gak dimasukin ke Master
    // Data — itu data statis, ini lebih ke alur campaign+klaim (create-only,
    // ada aksi "tawarkan ke member"). Admin-only karena create/offer
    // campaign admin-only di backend (VouchersController) meski GET-nya
    // sebenernya kebuka juga buat kasir.
    { href: '/voucher', label: 'Voucher' },
    // Barang Masuk (stock-in per-batch) DIHAPUS dari nav per 2026-09-15 —
    // form-nya sekarang nempel langsung di dialog "Lihat Batch"/"Stok" pada
    // Master > Produk & Master > Sparepart, gak perlu halaman/menu terpisah
    // lagi. Rute /stock lama masih ada tapi cuma redirect (buat bookmark
    // lama), gak dipasang di nav.
    // Opname (koreksi stok fisik) & Riwayat mutasi stok TETAP halaman
    // sendiri — beda tujuan (audit stok, bukan input harian), endpoint
    // admin yang sama (StockController).
    { href: '/stock/opname', label: 'Opname Stok' },
    // Siklus WA/Fonnte — admin-only (sama pembatasan kayak Voucher/Audit):
    // pengaturan siklus servis + redaksi template pesan digabung 1 halaman
    // 2 tab, riwayat kirim WA halaman terpisah (bisa jadi panjang/perlu
    // filter sendiri).
    { href: '/reminder-wa', label: 'Pengingat WA' },
    { href: '/reminder-wa/riwayat', label: 'Riwayat WA' },
    { href: '/pengguna', label: 'Pengguna' },
    // Log Audit — GET /audit-logs (AuditLogsModule) baca tabel audit_logs
    // yang udah lama ke-tulis dari banyak service (checkout, stock, master
    // data, user mgmt, dst) tapi belum ada tempat buat liatnya. Admin-only,
    // sama pembatasan kayak app mobile.
    { href: '/audit', label: 'Log Audit' },
    { href: '/laporan', label: 'Laporan' },
    { href: '/pengaturan', label: 'Pengaturan' },
    { href: '/profil', label: 'Profil' },
  ],
  kasir: [
    { href: '/pos', label: 'Kasir (POS)' },
    { href: '/invoices', label: 'Riwayat Transaksi' },
    { href: '/service-orders/intake', label: 'Servis Mandiri' },
    { href: '/members', label: 'Member' },
    { href: '/profil', label: 'Profil' },
  ],
  teknisi: [
    { href: '/teknisi/dashboard', label: 'Dashboard' },
    { href: '/teknisi/queue', label: 'Job' },
    { href: '/ac-units/scan', label: 'Scan Unit' },
    { href: '/teknisi/riwayat', label: 'Riwayat' },
    { href: '/profil', label: 'Profil' },
  ],
};
