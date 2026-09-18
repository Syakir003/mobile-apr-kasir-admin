'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Menu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/lib/session';
import { isNavGroup, NAV_BY_ROLE, type NavItem } from './nav-config';
import { NotificationBell } from './notification-bell';

// Dua varian styling nav item — desktop sidebar teal vs dropdown mobile
// putih BUKAN kebetulan, itu padanan 1:1 dari Flutter: `_Sidebar` (desktop,
// >=800px) solid tealDeep, sementara `_MobileNav` (viewport sempit) putih
// dengan aksen tealDeep di item aktif (lihat NavigationBarTheme di
// app_theme.dart). Jadi item nav yang sama butuh 2 set warna beda
// tergantung dia dirender di panel mana.
//
// Restyle 2026-09 — menu admin yang tadinya 15 item flat sekarang dikelompokin
// jadi NavGroup (lihat nav-config.ts) ala accordion di prototype "DealDeck
// E-POS AC": grup diklik buat expand/collapse anak-anaknya, tiap item (grup
// maupun daun) punya ikon di kiri label. Grup yang lagi punya halaman aktif
// di dalamnya otomatis kebuka duluan pas nav ini pertama dirender.
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
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of items) {
      if (isNavGroup(item) && item.children.some((child) => pathname.startsWith(child.href))) {
        initial.add(item.label);
      }
    }
    return initial;
  });

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }

  return (
    <nav className="grid gap-1">
      {items.map((item) => {
        if (isNavGroup(item)) {
          const open = openGroups.has(item.label);
          const groupHasActiveChild = item.children.some((child) =>
            pathname.startsWith(child.href),
          );
          return (
            <div key={item.label}>
              <button
                type="button"
                onClick={() => toggleGroup(item.label)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                  variant === 'sidebar'
                    ? groupHasActiveChild
                      ? 'text-white'
                      : 'text-sidebar-foreground hover:bg-white/10'
                    : groupHasActiveChild
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-secondary-foreground',
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                <ChevronDown
                  className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')}
                />
              </button>
              {open && (
                <div className="mt-0.5 grid gap-0.5 pl-4">
                  {item.children.map((child) => {
                    const active = pathname.startsWith(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavigate}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                          variant === 'sidebar'
                            ? active
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground/80 hover:bg-white/10'
                            : active
                              ? 'bg-secondary text-secondary-foreground'
                              : 'text-muted-foreground hover:bg-secondary/60 hover:text-secondary-foreground',
                        )}
                      >
                        <child.icon className="size-3.5 shrink-0" />
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              variant === 'sidebar'
                ? active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-white/10'
                : active
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-secondary-foreground',
            )}
          >
            <item.icon className="size-4 shrink-0" />
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
            {/* Logo APR (Ayub Podo Rukun) — dikasih chip putih biar kontras
                di atas background teal sidebar, warna logonya (biru+abu2)
                jadi kelap-kelip ketimbang nyambung sama teal. */}
            <div className="mb-2 flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white p-1.5">
                <Image src="/logo-apr.png" alt="AYUB AC" width={28} height={16} className="h-auto w-full" />
              </div>
              <p className="text-lg font-bold text-white">E-POS AC</p>
            </div>
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
