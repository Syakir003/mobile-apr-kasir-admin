import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/app_user.dart';
import '../router/app_router.dart';
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
      (icon: Icons.bar_chart_outlined, label: 'Laporan', route: '/laporan'),
      scan,
      profile,
    ];
  }
  if (role == UserRole.kasir) {
    return const [dashboard, pos, riwayat, order, profile];
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
                borderRadius: BorderRadius.circular(999),
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
    return Container(
      width: 260,
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(right: BorderSide(color: AppColors.slate200)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header logo
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              border:
                  Border(bottom: BorderSide(color: AppColors.slate200)),
            ),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: AppColors.teal600,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: const Icon(Icons.ac_unit,
                      color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                const Text(
                  'E-POS AC',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    color: AppColors.slate900,
                  ),
                ),
              ],
            ),
          ),
          // Menu
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                  child: Text(
                    'MENU ${_roleLabel(user?.role).toUpperCase()}',
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.6,
                      color: AppColors.slate400,
                    ),
                  ),
                ),
                for (var i = 0; i < destinations.length; i++)
                  _SidebarItem(
                    destination: destinations[i],
                    selected: i == selectedIndex,
                    onTap: () => onSelected(i),
                  ),
              ],
            ),
          ),
          // Footer user + logout
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: AppColors.slate200)),
            ),
            child: Column(
              children: [
                // Tap area profil (avatar + nama) menuju halaman Profil.
                Material(
                  color: Colors.transparent,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  child: InkWell(
                    onTap: () => context.go('/profile'),
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                    hoverColor: AppColors.slate100,
                    child: Padding(
                      padding: const EdgeInsets.all(6),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 20,
                            backgroundColor: AppColors.teal50,
                            child: Text(
                              _roleLabel(user?.role).characters.first,
                              style: const TextStyle(
                                color: AppColors.teal700,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  user?.displayName.isNotEmpty == true
                                      ? user!.displayName
                                      : '${_roleLabel(user?.role)} User',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.slate900,
                                  ),
                                ),
                                const Text(
                                  'Lihat profil',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: AppColors.slate500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right,
                              size: 18, color: AppColors.slate400),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: TextButton.icon(
                    onPressed: onLogout,
                    icon: const Icon(Icons.logout, size: 18),
                    label: const Text('Logout'),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.red600,
                      alignment: Alignment.centerLeft,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
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
    final fg = selected ? AppColors.teal700 : AppColors.slate600;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: selected ? AppColors.teal50 : Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          hoverColor: AppColors.slate100,
          child: Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            child: Row(
              children: [
                Icon(destination.icon, size: 20, color: fg),
                const SizedBox(width: 12),
                Text(
                  destination.label,
                  style: TextStyle(
                    color: fg,
                    fontSize: 14,
                    fontWeight:
                        selected ? FontWeight.w600 : FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
