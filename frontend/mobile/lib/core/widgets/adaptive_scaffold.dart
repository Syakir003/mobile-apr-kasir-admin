import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/app_user.dart';
import '../router/app_router.dart';
import '../theme/app_motion.dart';
import '../theme/app_theme.dart';

typedef Destination = ({IconData icon, String label, String route});

/// Daftar destinasi navigasi menurut role.
/// Admin melihat POS + riwayat + seluruh modul master + member + scan; kasir
/// melihat Dashboard + Transaksi + Riwayat; teknisi mendapat Scan.
List<Destination> destinationsForRole(UserRole? role) {
  const dashboard = (
    icon: Icons.dashboard_outlined,
    label: 'Dashboard',
    route: '/',
  );
  const pos = (
    icon: Icons.point_of_sale,
    label: 'Transaksi',
    route: '/pos',
  );
  const riwayat = (
    icon: Icons.receipt_long_outlined,
    label: 'Riwayat',
    route: '/transactions',
  );
  const scan = (
    icon: Icons.qr_code_scanner,
    label: 'Scan',
    route: '/scan',
  );
  const order = (
    icon: Icons.assignment_outlined,
    label: 'Order',
    route: '/orders',
  );
  const job = (
    icon: Icons.handyman_outlined,
    label: 'Job',
    route: '/jobs',
  );
  const profile = (
    icon: Icons.person_outline,
    label: 'Profil',
    route: '/profile',
  );
  // Antrean pengingat servis WhatsApp — admin & kasir saja (teknisi tidak boleh
  // melihat data pelanggan, lihat `redirect.dart`).
  const pengingat = (
    icon: Icons.notifications_active_outlined,
    label: 'Pengingat',
    route: '/pengingat',
  );
  if (role == UserRole.admin) {
    return const [
      dashboard,
      pos,
      riwayat,
      (icon: Icons.ac_unit, label: 'Produk', route: '/products'),
      (icon: Icons.build_outlined, label: 'Sparepart', route: '/spareparts'),
      (icon: Icons.room_service_outlined, label: 'Jasa', route: '/services'),
      (icon: Icons.inventory_2_outlined, label: 'Paket', route: '/packages'),
      (icon: Icons.people_outlined, label: 'Member', route: '/members'),
      order,
      job,
      pengingat,
      (icon: Icons.inventory_outlined, label: 'Stok', route: '/stok'),
      (icon: Icons.bar_chart_outlined, label: 'Laporan', route: '/laporan'),
      (icon: Icons.manage_accounts_outlined, label: 'Akun', route: '/users'),
      (icon: Icons.history, label: 'Audit', route: '/audit'),
      scan,
      profile,
    ];
  }
  if (role == UserRole.kasir) {
    return const [dashboard, pos, riwayat, order, pengingat, profile];
  }
  if (role == UserRole.teknisi) {
    return const [dashboard, job, scan, profile];
  }
  return const [dashboard];
}

/// Indeks destinasi terpilih berdasarkan lokasi saat ini (prefix match).
int selectedIndexFor(List<Destination> destinations, String location) {
  var best = 0;
  var bestLen = -1;
  for (var i = 0; i < destinations.length; i++) {
    final route = destinations[i].route;
    final isMatch = route == '/'
        ? location == '/'
        : location == route || location.startsWith('$route/');
    if (isMatch && route.length > bestLen) {
      best = i;
      bestLen = route.length;
    }
  }
  return best;
}

String _roleLabel(UserRole? role) => switch (role) {
      UserRole.admin => 'Admin',
      UserRole.kasir => 'Kasir',
      UserRole.teknisi => 'Teknisi',
      null => 'Pengguna',
    };

class AdaptiveScaffold extends ConsumerWidget {
  const AdaptiveScaffold({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).value;
    final role = user?.role;
    final destinations = destinationsForRole(role);

    // NavigationBar/Rail butuh minimal 2 destinasi. Bila hanya satu (mis. null
    // saat memuat), tampilkan child polos tanpa navigasi.
    if (destinations.length < 2) {
      return Scaffold(body: child);
    }

    final location = GoRouterState.of(context).matchedLocation;
    final selectedIndex = selectedIndexFor(destinations, location);

    void onSelected(int index) => context.go(destinations[index].route);

    final wide = MediaQuery.sizeOf(context).width >= 800;
    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            _Sidebar(
              destinations: destinations,
              selectedIndex: selectedIndex,
              onSelected: onSelected,
              user: user,
              onLogout: () => ref.read(authRepositoryProvider).signOut(),
            ),
            Expanded(child: child),
          ],
        ),
      );
    }
    return Scaffold(
      body: child,
      bottomNavigationBar: _MobileNav(
        destinations: destinations,
        selectedIndex: selectedIndex,
        onSelected: onSelected,
      ),
    );
  }
}

/// Bottom navigation untuk layar sempit. Bila destinasi lebih dari 5 (mis.
/// admin dengan 10 menu), tampilkan 4 destinasi utama + tab "Lainnya" yang
/// membuka sheet berisi sisanya, agar label tidak berdesakan/terpotong.
class _MobileNav extends StatelessWidget {
  const _MobileNav({
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
  });

  final List<Destination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  /// Jumlah destinasi utama sebelum digantikan tab "Lainnya".
  static const _maxPrimary = 4;

  @override
  Widget build(BuildContext context) {
    // Cukup muat dalam satu baris (≤ 5 total) → NavigationBar biasa.
    if (destinations.length <= _maxPrimary + 1) {
      return NavigationBar(
        selectedIndex: selectedIndex,
        destinations: [
          for (final d in destinations)
            NavigationDestination(icon: Icon(d.icon), label: d.label),
        ],
        onDestinationSelected: onSelected,
      );
    }

    final primary = destinations.take(_maxPrimary).toList();
    final inOverflow = selectedIndex >= _maxPrimary;

    return NavigationBar(
      selectedIndex: inOverflow ? _maxPrimary : selectedIndex,
      destinations: [
        for (final d in primary)
          NavigationDestination(icon: Icon(d.icon), label: d.label),
        NavigationDestination(
          // Saat menu di dalam "Lainnya" sedang aktif, tampilkan ikonnya
          // agar tetap terlihat destinasi mana yang terpilih.
          icon: Icon(
            inOverflow ? destinations[selectedIndex].icon : Icons.more_horiz,
          ),
          label: 'Lainnya',
        ),
      ],
      onDestinationSelected: (index) {
        if (index < _maxPrimary) {
          onSelected(index);
        } else {
          _openMore(context);
        }
      },
    );
  }

  void _openMore(BuildContext context) {
    final overflow = destinations.skip(_maxPrimary).toList();
    final selectedInOverflow = selectedIndex - _maxPrimary;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.slate200,
                borderRadius: BorderRadius.circular(AppRadius.pill),
              ),
            ),
            const SizedBox(height: 6),
            for (var i = 0; i < overflow.length; i++)
              ListTile(
                leading: Icon(
                  overflow[i].icon,
                  color: i == selectedInOverflow
                      ? AppColors.teal700
                      : AppColors.slate500,
                ),
                title: Text(
                  overflow[i].label,
                  style: TextStyle(
                    color: i == selectedInOverflow
                        ? AppColors.teal700
                        : AppColors.slate900,
                    fontWeight: i == selectedInOverflow
                        ? FontWeight.w600
                        : FontWeight.w500,
                  ),
                ),
                selected: i == selectedInOverflow,
                selectedTileColor: AppColors.teal50,
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  onSelected(_maxPrimary + i);
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

/// Sidebar bergaya desain Figma: header logo, menu per-role, footer user.
class _Sidebar extends StatelessWidget {
  const _Sidebar({
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
    required this.user,
    required this.onLogout,
  });

  final List<Destination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final AppUser? user;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    // Sidebar teal dengan sudut kanan membulat 32px dan bayangan ke arah
    // konten — mengikuti frame `SideNavBar` (10:267) pada desain.
    final showCta = destinations.any((d) => d.route == '/pos');

    return Container(
      width: 260,
      padding: const EdgeInsets.symmetric(vertical: 32),
      decoration: const BoxDecoration(
        color: AppColors.tealDeep,
        borderRadius: BorderRadius.horizontal(right: Radius.circular(32)),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadowSoft,
            offset: Offset(4, 0),
            blurRadius: 20,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header: avatar bercincin Teal Bright + brand + peran.
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.navAvatarRing, width: 2),
                  ),
                  clipBehavior: Clip.antiAlias,
                  padding: const EdgeInsets.all(4),
                  child: Image.asset('assets/brand/favicon-512.png'),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'E-POS AC',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: AppFonts.display,
                          fontSize: 18,
                          height: 24 / 18,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      Text(
                        _roleLabel(user?.role),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: AppFonts.body,
                          fontSize: 12,
                          height: 16 / 12,
                          color: AppColors.navMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // CTA transaksi baru — hanya untuk peran yang punya akses POS.
          if (showCta)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: Material(
                color: AppColors.navAccent,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                child: InkWell(
                  onTap: () => context.go('/pos'),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  child: const Padding(
                    padding:
                        EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.add, size: 16, color: Colors.white),
                        SizedBox(width: 8),
                        Text(
                          'Transaksi Baru',
                          style: TextStyle(
                            fontFamily: AppFonts.display,
                            fontSize: 15,
                            height: 20 / 15,
                            fontWeight: FontWeight.w500,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

          // Menu — item aktif berupa pill yang membulat di sisi kiri saja.
          //
          // Admin punya 16 destinasi, jadi daftar ini hampir selalu menggulir.
          // Tanpa peredup di kedua ujung, item yang setengah tergulir terpotong
          // rata di tengah huruf dan terbaca seperti tampilan yang rusak, bukan
          // seperti daftar yang masih ada lanjutannya.
          Expanded(
            child: ShaderMask(
              blendMode: BlendMode.dstIn,
              shaderCallback: (rect) => const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  Colors.black,
                  Colors.black,
                  Colors.transparent,
                ],
                stops: [0, 0.05, 0.94, 1],
              ).createShader(rect),
              child: ListView(
                padding: const EdgeInsets.only(left: 8, top: 6, bottom: 10),
                children: [
                  for (var i = 0; i < destinations.length; i++)
                    _SidebarItem(
                      destination: destinations[i],
                      selected: i == selectedIndex,
                      onTap: () => onSelected(i),
                    ),
                ],
              ),
            ),
          ),

          // Footer: profil + logout, dipisah garis Teal Pale 10%.
          Container(
            margin: const EdgeInsets.only(top: 16),
            padding: const EdgeInsets.fromLTRB(24, 17, 24, 0),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: AppColors.navDivider)),
            ),
            child: Column(
              children: [
                _SidebarAction(
                  icon: Icons.person_outline,
                  label: user?.displayName.isNotEmpty == true
                      ? user!.displayName
                      : 'Profil',
                  onTap: () => context.go('/profile'),
                ),
                _SidebarAction(
                  icon: Icons.logout,
                  label: 'Logout',
                  onTap: onLogout,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Baris aksi pada footer sidebar (profil / logout).
class _SidebarAction extends StatelessWidget {
  const _SidebarAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        hoverColor: Colors.white.withValues(alpha: 0.06),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Icon(icon, size: 16, color: AppColors.navMuted),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: AppFonts.display,
                    fontSize: 15,
                    height: 20 / 15,
                    fontWeight: FontWeight.w500,
                    color: AppColors.navMuted,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SidebarItem extends StatelessWidget {
  const _SidebarItem({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  final Destination destination;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Item aktif sengaja menempel ke tepi kanan sidebar (hanya sudut kiri yang
    // membulat) supaya menyatu dengan area konten, seperti pada desain.
    const shape = BorderRadius.horizontal(left: Radius.circular(AppRadius.pill));
    final fg = selected ? AppColors.navAccent : AppColors.navMuted;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      // Pil aktif berpindah dengan memudar, bukan berkedip dari satu baris ke
      // baris lain: sidebar adalah elemen yang paling sering dilihat, dan
      // pergantian mendadak di sana yang paling terasa kaku.
      child: AnimatedContainer(
        duration: AppDurations.base,
        curve: AppCurves.standard,
        decoration: BoxDecoration(
          color: selected ? AppColors.mistDeep : Colors.transparent,
          borderRadius: shape,
        ),
        child: Material(
          type: MaterialType.transparency,
          borderRadius: shape,
          child: InkWell(
            onTap: onTap,
            borderRadius: shape,
            hoverColor: Colors.white.withValues(alpha: 0.06),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              child: Row(
                children: [
                  AnimatedScale(
                    duration: AppDurations.base,
                    curve: AppCurves.emphasized,
                    scale: selected ? 1.08 : 1,
                    child: Icon(destination.icon, size: 18, color: fg),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: AnimatedDefaultTextStyle(
                      duration: AppDurations.base,
                      curve: AppCurves.standard,
                      style: TextStyle(
                        fontFamily: AppFonts.display,
                        fontSize: 15,
                        height: 20 / 15,
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w500,
                        color: fg,
                      ),
                      child: Text(
                        destination.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
