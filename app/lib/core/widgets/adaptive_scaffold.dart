import 'package:flutter/material.dart';

const _destinations = [
  (icon: Icons.dashboard_outlined, label: 'Dashboard'),
  (icon: Icons.person_outline, label: 'Profil'),
];

class AdaptiveScaffold extends StatelessWidget {
  const AdaptiveScaffold({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 600;
    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: 0,
              labelType: NavigationRailLabelType.all,
              destinations: [
                for (final d in _destinations)
                  NavigationRailDestination(icon: Icon(d.icon), label: Text(d.label)),
              ],
              onDestinationSelected: (_) {},
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
        selectedIndex: 0,
        destinations: [
          for (final d in _destinations)
            NavigationDestination(icon: Icon(d.icon), label: d.label),
        ],
        onDestinationSelected: (_) {},
      ),
    );
  }
}
