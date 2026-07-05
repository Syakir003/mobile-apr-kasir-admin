import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/app_user.dart';
import '../router/app_router.dart';

typedef Destination = ({IconData icon, String label, String route});

/// Daftar destinasi navigasi menurut role.
/// Admin melihat seluruh modul master; kasir/teknisi/null hanya Dashboard
/// (fase berikutnya menambah menu untuk kasir & teknisi).
List<Destination> destinationsForRole(UserRole? role) {
  const dashboard = (
    icon: Icons.dashboard_outlined,
    label: 'Dashboard',
    route: '/',
  );
  if (role == UserRole.admin) {
    return const [
      dashboard,
      (icon: Icons.ac_unit, label: 'Produk', route: '/products'),
      (icon: Icons.build_outlined, label: 'Sparepart', route: '/spareparts'),
      (icon: Icons.handyman_outlined, label: 'Jasa', route: '/services'),
      (icon: Icons.inventory_2_outlined, label: 'Paket', route: '/packages'),
    ];
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

class AdaptiveScaffold extends ConsumerWidget {
  const AdaptiveScaffold({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(currentUserProvider).value?.role;
    final destinations = destinationsForRole(role);

    // NavigationBar/NavigationRail butuh minimal 2 destinasi. Bila hanya satu
    // (kasir/teknisi/null di fase ini), tampilkan child polos tanpa navigasi.
    if (destinations.length < 2) {
      return Scaffold(body: child);
    }

    final location = GoRouterState.of(context).matchedLocation;
    final selectedIndex = selectedIndexFor(destinations, location);

    void onSelected(int index) => context.go(destinations[index].route);

    final wide = MediaQuery.sizeOf(context).width >= 600;
    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: selectedIndex,
              labelType: NavigationRailLabelType.all,
              destinations: [
                for (final d in destinations)
                  NavigationRailDestination(
                    icon: Icon(d.icon),
                    label: Text(d.label),
                  ),
              ],
              onDestinationSelected: onSelected,
            ),
            const VerticalDivider(width: 1),
            Expanded(child: child),
          ],
        ),
      );
    }
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: selectedIndex,
        destinations: [
          for (final d in destinations)
            NavigationDestination(icon: Icon(d.icon), label: d.label),
        ],
        onDestinationSelected: onSelected,
      ),
    );
  }
}
