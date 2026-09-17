'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/lib/session';
import { NAV_BY_ROLE, type NavItem } from './nav-config';
import { NotificationBell } from './notification-bell';

// Dua varian styling nav item — desktop sidebar teal vs dropdown mobile
// putih BUKAN kebetulan, itu padanan 1:1 dari Flutter: `_Sidebar` (desktop,
// >=800px) solid tealDeep, sementara `_MobileNav` (viewport sempit) putih
// dengan aksen tealDeep di item aktif (lihat NavigationBarTheme di
// app_theme.dart). Jadi item nav yang sama butuh 2 set warna beda
// tergantung dia dirender di panel mana.
function NavLinks({
  items,
  variant,
  onNavigate,
}: {
  items: NavItem[];
  variant: 'sidebar' | 'mobile';
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="grid gap-1">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              variant === 'sidebar'
                ? active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-white/10'
                : active
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-secondary-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const navItems = NAV_BY_ROLE[user.role];

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    // h-screen + overflow-hidden di level ini — sidebar & header jadi diem
    // di tempat, yang scroll cuma <main> di bawah (overflow-y-auto sendiri).
    // print:* di-override balik ke auto/visible biar halaman cetak (invoice/
    // surat jalan/label) gak kepotong sama batas viewport pas di-print.
    <div className="flex h-screen w-full overflow-hidden print:h-auto print:overflow-visible">
      {/* Padanan `_Sidebar` (adaptive_scaffold.dart): bg solid tealDeep,
          lebar 260px fixed, radius 32px cuma sudut kanan, shadow teal ke
          arah konten — bukan border hairline kayak sebelumnya.
          `print:hidden` — halaman cetak (invoice/surat jalan/label, lihat
          app/(dashboard)/invoices/[id]/print & service-orders/[id]/print*)
          gak boleh ikut ke-print, cuma dokumennya doang. */}
      {/* overflow-hidden di <aside> (bukan overflow-y-auto kayak sebelumnya)
          — judul & tombol Keluar sekarang diem di tempat (shrink-0), CUMA
          daftar menu di tengah yang scroll kalau kepanjangan (min-h-0 wajib
          di situ, tanpa itu flex child gak mau nyusut buat mulai scroll).
          Scrollbar bawaan browser sengaja disembunyiin (tetep bisa
          discroll pakai wheel/drag, cuma track abu-abu panjangnya yang
          gak keliatan) — kepanjangan kalau dibiarin nampang di sidebar
          sesempit ini. */}
      <aside className="hidden h-full w-[260px] shrink-0 flex-col overflow-hidden rounded-r-[2rem] bg-sidebar text-sidebar-foreground shadow-[4px_0_20px_rgba(11,107,98,0.15)] md:flex print:hidden">
        <div className="shrink-0 px-4 pt-4">
          <div className="mb-8 px-2">
            <p className="text-lg font-bold text-white">E-POS AC</p>
            <p className="text-xs text-sidebar-foreground">{user.displayName}</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <NavLinks items={navItems} variant="sidebar" />
        </div>
        <div className="shrink-0 px-4 pt-4 pb-4">
          <Separator className="mb-3 bg-sidebar-border" />
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground hover:bg-white/10 hover:text-white"
            onClick={handleLogout}
          >
            <LogOut className="size-4" />
            Keluar
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col print:h-auto print:overflow-visible">
        {/* Header tipis di atas <main> — SEBELUMNYA cuma ada di mobile
            (judul + tombol hamburger). Sekarang selalu tampil (desktop
            ikutan) karena butuh tempat buat NotificationBell (Siklus
            Notifikasi Push) yang harus keliatan di semua ukuran layar, gak
            cuma mobile. Judul "E-POS AC" & tombol hamburger TETAP md:hidden
            (desktop udah ada judul di sidebar, gak perlu dobel). Nav mobile
            TETAP putih (bg-card) — padanan `_MobileNav` Flutter, yang juga
            gak pernah dibikin teal kayak sidebar desktop. shrink-0 biar
            header ini gak ikut kegencet pas <main> scroll. */}
        <header className="flex shrink-0 items-center justify-between border-b bg-card px-4 py-2 print:hidden">
          <p className="text-sm font-semibold md:hidden">E-POS AC</p>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
            >
              <Menu className="size-5" />
            </Button>
          </div>
        </header>
        {mobileOpen && (
          <div className="shrink-0 border-b bg-card p-4 md:hidden print:hidden">
            <NavLinks items={navItems} variant="mobile" onNavigate={() => setMobileOpen(false)} />
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full justify-start"
              onClick={handleLogout}
            >
              <LogOut className="size-4" />
              Keluar
            </Button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 print:h-auto print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
