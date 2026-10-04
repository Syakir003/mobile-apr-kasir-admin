import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Boxes,
  Cog,
  Hammer,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Database,
  FileBarChart2,
  FilePlus2,
  HeartHandshake,
  History,
  Inbox,
  LayoutDashboard,
  Package,
  Receipt,
  ScanLine,
  ScrollText,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Ticket,
  UserCircle,
  UserCog,
  UserPlus,
  Users,
  Warehouse,
  Wrench,
} from 'lucide-react';

import type { Role } from '@/lib/session';

// Item nav "daun" — link beneran, selalu punya href & icon (padanan sidebar
// prototype "DealDeck E-POS AC" yang tiap barisnya ada ikon di kiri label).
export interface NavLeaf {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Grup nav — BUKAN link, cuma header yang expand/collapse buat nampilin
// anak-anaknya (NavLeaf). Dipakai kalau menu utamanya kebanyakan submenu
// yang berkaitan biar sidebar admin gak numpuk panjang terus-terusan kebuka
// semua. Grup yang berisi halaman aktif otomatis terbuka (dashboard-shell).
export interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavLeaf[];
}

export type NavItem = NavLeaf | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return 'children' in item;
}

// Menu per role — SATU shell dipakai buat semua role (bukan folder
// per-role), nav-nya aja yang difilter. Konsisten sama keputusan arsitektur
// di plan/2026-08-23-rencana-frontend-nextjs.md §route groups.
//
// Penamaan (2026-10-04): label pakai bahasa kerja sehari-hari, bukan istilah
// teknis ("Terima Servis Baru", "Permintaan Material"), dan grup disusun
// menurut PEKERJAAN admin (jual, servis, stok, pelanggan, data, laporan),
// bukan menurut jenis data. Judul halaman (<h1>) harus sama dengan label di
// sini supaya pengguna tidak merasa pindah ke halaman lain.
//
// Role kasir & teknisi SENGAJA dibiarin flat (gak dikelompokkan) — item-nya
// cuma 5, masih enak dibaca tanpa accordion. Grouping cuma buat admin yang
// menunya paling banyak.
export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    {
      label: 'Penjualan',
      icon: ShoppingCart,
      children: [
        { href: '/pos', label: 'Kasir (POS)', icon: CreditCard },
        { href: '/invoices', label: 'Riwayat Transaksi', icon: Receipt },
        // Voucher (campaign diskon buat member) — alur campaign+klaim, bukan
        // data statis, jadi ikut Penjualan (bukan Data Master).
        { href: '/voucher', label: 'Voucher', icon: Ticket },
      ],
    },
    {
      label: 'Servis AC',
      icon: Wrench,
      children: [
        { href: '/teknisi/queue', label: 'Antrian Servis', icon: ClipboardList },
        { href: '/service-orders/intake', label: 'Terima Servis Baru', icon: UserPlus },
        // Approval sparepart tambahan yang diajukan teknisi saat servis
        // on-site (backend: material-requests module).
        { href: '/material-requests', label: 'Permintaan Material', icon: Inbox },
      ],
    },
    {
      label: 'Stok & Gudang',
      icon: Warehouse,
      children: [
        // Tahap KEDUA checkout (Siklus QR per-unit, 2026-09-30) — konfirmasi
        // fisik unit yang keluar dari gudang abis invoice terbit di POS.
        { href: '/kasir-scan', label: 'Keluar Gudang (Scan)', icon: ScanLine },
        // Opname (koreksi stok fisik) — aktivitas stok, bukan data master.
        // Barang Masuk (stock-in) sengaja tidak punya menu: form-nya nempel
        // di dialog "Lihat Batch"/"Stok" pada Master > Produk & Sparepart.
        { href: '/stock/opname', label: 'Opname Stok', icon: ClipboardCheck },
      ],
    },
    {
      label: 'Pelanggan',
      icon: HeartHandshake,
      children: [
        { href: '/members', label: 'Member', icon: Users },
        // Siklus WA/Fonnte — admin-only: pengaturan siklus servis + redaksi
        // template pesan digabung 1 halaman 2 tab, riwayat kirim terpisah.
        { href: '/reminder-wa', label: 'Pengingat WA', icon: Bell },
        { href: '/reminder-wa/riwayat', label: 'Riwayat WA', icon: History },
      ],
    },
    {
      label: 'Data Master',
      icon: Database,
      children: [
        // Langsung ke tiap data master (tanpa halaman kartu /master dulu),
        // sama seperti menu gudang.
        { href: '/master/produk', label: 'Produk AC', icon: Package },
        { href: '/master/sparepart', label: 'Sparepart', icon: Cog },
        { href: '/master/jasa', label: 'Jasa', icon: Hammer },
        { href: '/master/paket', label: 'Paket Instalasi', icon: Boxes },
      ],
    },
    // Laporan dipakai rutin oleh admin/pemilik — naik jadi menu utama
    // (sebelumnya tersembunyi di dalam grup Administrasi).
    { href: '/laporan', label: 'Laporan', icon: FileBarChart2 },
    {
      label: 'Pengaturan',
      icon: Settings,
      children: [
        { href: '/pengguna', label: 'Pengguna', icon: UserCog },
        // Input Data Lampau (2026-10-01) — menggantikan "Input Transaksi
        // Manual": migrasi customer lama + unit AC + QR + transaksi opsional.
        { href: '/administrasi/data-lampau', label: 'Input Data Lampau', icon: FilePlus2 },
        // Log Audit — GET /audit-logs, admin-only.
        { href: '/audit', label: 'Log Audit', icon: ScrollText },
        { href: '/pengaturan', label: 'Pengaturan Toko', icon: SlidersHorizontal },
      ],
    },
    { href: '/profil', label: 'Profil', icon: UserCircle },
  ],
  kasir: [
    { href: '/pos', label: 'Kasir (POS)', icon: CreditCard },
    { href: '/invoices', label: 'Riwayat Transaksi', icon: Receipt },
    { href: '/service-orders/intake', label: 'Terima Servis Baru', icon: UserPlus },
    { href: '/members', label: 'Member', icon: Users },
    { href: '/profil', label: 'Profil', icon: UserCircle },
  ],
  teknisi: [
    { href: '/teknisi/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/teknisi/queue', label: 'Job Saya', icon: ClipboardList },
    { href: '/ac-units/scan', label: 'Scan Unit', icon: ScanLine },
    { href: '/teknisi/riwayat', label: 'Riwayat', icon: History },
    { href: '/profil', label: 'Profil', icon: UserCircle },
  ],
  // Staf stok (2026-10-03): produk & sparepart (harga jual tetap admin-only
  // di backend) + opname. Sengaja gak lewat halaman /master (ada Jasa/Paket).
  gudang: [
    {
      label: 'Master Data',
      icon: Database,
      children: [
        { href: '/master/produk', label: 'Produk AC', icon: Package },
        { href: '/master/sparepart', label: 'Sparepart', icon: Cog },
      ],
    },
    { href: '/kasir-scan', label: 'Keluar Gudang (Scan)', icon: ScanLine },
    { href: '/stock/opname', label: 'Opname Stok', icon: ClipboardCheck },
    { href: '/stock/laporan', label: 'Laporan Stok', icon: FileBarChart2 },
    { href: '/profil', label: 'Profil', icon: UserCircle },
  ],
};
