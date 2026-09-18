import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Database,
  FileBarChart2,
  FilePlus2,
  History,
  Inbox,
  LayoutDashboard,
  MessageCircle,
  Package,
  Receipt,
  ScanLine,
  ScrollText,
  Settings,
  ShoppingCart,
  Ticket,
  UserCircle,
  UserCog,
  UserPlus,
  Users,
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
// yang berkaitan (Transaksi, Servis, dst) biar sidebar admin (15 item flat
// sebelumnya) gak numpuk panjang terus-terusan kebuka semua.
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
// Role kasir & teknisi SENGAJA dibiarin flat (gak dikelompokkan) — item-nya
// cuma 5, masih enak dibaca tanpa accordion. Grouping cuma buat admin yang
// menunya paling banyak.
export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    {
      label: 'Transaksi',
      icon: ShoppingCart,
      children: [
        { href: '/pos', label: 'Kasir (POS)', icon: CreditCard },
        { href: '/invoices', label: 'Riwayat Transaksi', icon: Receipt },
        // Migrasi data histori (transaksi + member dari sebelum sistem ini
        // ada) — admin-only, lihat proxy.ts prefix '/invoices/manual' &
        // backend InvoicesController.createManual.
        { href: '/invoices/manual', label: 'Input Transaksi Manual', icon: FilePlus2 },
        // Voucher (campaign diskon buat member) digabung ke grup Transaksi
        // (bukan Data Master) — itu lebih ke alur campaign+klaim, bukan
        // data statis.
        { href: '/voucher', label: 'Voucher', icon: Ticket },
      ],
    },
    {
      label: 'Servis',
      icon: Wrench,
      children: [
        { href: '/teknisi/queue', label: 'Servis & Teknisi', icon: ClipboardList },
        { href: '/service-orders/intake', label: 'Servis Mandiri', icon: UserPlus },
        // Approval sparepart tambahan yang diajukan teknisi saat servis
        // on-site — backend-nya (material-requests module) udah lama ada &
        // dipakai app mobile lama, ini UI web-nya (baru).
        { href: '/material-requests', label: 'Pengajuan Masuk', icon: Inbox },
      ],
    },
    // Member SENGAJA di luar grup (standalone, sejajar Dashboard/Profil) —
    // dipakai sesering menu transaksi, jadi biar gampang dijangkau tanpa
    // buka accordion dulu.
    { href: '/members', label: 'Member', icon: Users },
    {
      label: 'Data Master',
      icon: Database,
      children: [
        { href: '/master', label: 'Master Data', icon: Package },
        // Barang Masuk (stock-in per-batch) DIHAPUS dari nav per 2026-09-15
        // — form-nya sekarang nempel langsung di dialog "Lihat Batch"/"Stok"
        // pada Master > Produk & Master > Sparepart, gak perlu halaman/menu
        // terpisah lagi. Rute /stock lama masih ada tapi cuma redirect
        // (buat bookmark lama), gak dipasang di nav.
        // Opname (koreksi stok fisik) TETAP halaman sendiri — beda tujuan
        // (audit stok, bukan input harian), endpoint admin sama (StockController).
        { href: '/stock/opname', label: 'Opname Stok', icon: ClipboardCheck },
      ],
    },
    {
      label: 'WhatsApp',
      icon: MessageCircle,
      children: [
        // Siklus WA/Fonnte — admin-only (sama pembatasan kayak
        // Voucher/Audit): pengaturan siklus servis + redaksi template pesan
        // digabung 1 halaman 2 tab, riwayat kirim WA halaman terpisah (bisa
        // jadi panjang/perlu filter sendiri).
        { href: '/reminder-wa', label: 'Pengingat WA', icon: Bell },
        { href: '/reminder-wa/riwayat', label: 'Riwayat WA', icon: History },
      ],
    },
    {
      label: 'Administrasi',
      icon: Settings,
      children: [
        { href: '/pengguna', label: 'Pengguna', icon: UserCog },
        // Log Audit — GET /audit-logs (AuditLogsModule) baca tabel
        // audit_logs yang udah lama ke-tulis dari banyak service (checkout,
        // stock, master data, user mgmt, dst) tapi belum ada tempat buat
        // liatnya. Admin-only, sama pembatasan kayak app mobile.
        { href: '/audit', label: 'Log Audit', icon: ScrollText },
        { href: '/laporan', label: 'Laporan', icon: FileBarChart2 },
        { href: '/pengaturan', label: 'Pengaturan', icon: Settings },
      ],
    },
    { href: '/profil', label: 'Profil', icon: UserCircle },
  ],
  kasir: [
    { href: '/pos', label: 'Kasir (POS)', icon: CreditCard },
    { href: '/invoices', label: 'Riwayat Transaksi', icon: Receipt },
    { href: '/service-orders/intake', label: 'Servis Mandiri', icon: UserPlus },
    { href: '/members', label: 'Member', icon: Users },
    { href: '/profil', label: 'Profil', icon: UserCircle },
  ],
  teknisi: [
    { href: '/teknisi/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/teknisi/queue', label: 'Job', icon: ClipboardList },
    { href: '/ac-units/scan', label: 'Scan Unit', icon: ScanLine },
    { href: '/teknisi/riwayat', label: 'Riwayat', icon: History },
    { href: '/profil', label: 'Profil', icon: UserCircle },
  ],
};
