import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/adaptive_scaffold.dart';
import '../../data/models/app_user.dart';

const _accents = [
  AppColors.teal600,
  AppColors.blue600,
  AppColors.orange600,
  AppColors.indigo600,
  AppColors.green600,
  AppColors.red600,
];

String _roleName(UserRole? r) => switch (r) {
      UserRole.admin => 'Admin',
      UserRole.kasir => 'Kasir',
      UserRole.teknisi => 'Teknisi',
      null => '',
    };

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).value;
    // Pintasan = destinasi role selain Dashboard itu sendiri.
    final shortcuts = destinationsForRole(user?.role)
        .where((d) => d.route != '/')
        .toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          const Padding(
            padding: EdgeInsets.only(right: 8),
            child: _RealtimeBadge(),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Keluar',
            onPressed: () => ref.read(authRepositoryProvider).signOut(),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _Greeting(user: user),
          const SizedBox(height: 20),
          Text(
            'Akses Cepat',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(color: AppColors.slate900),
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, c) {
              final cols = c.maxWidth >= 1000
                  ? 4
                  : c.maxWidth >= 640
                      ? 3
                      : 2;
              return GridView.count(
                crossAxisCount: cols,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 14,
                crossAxisSpacing: 14,
                childAspectRatio: 1.35,
                children: [
                  for (var i = 0; i < shortcuts.length; i++)
                    _ActionCard(
                      icon: shortcuts[i].icon,
                      label: shortcuts[i].label,
                      accent: _accents[i % _accents.length],
                      onTap: () => context.go(shortcuts[i].route),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting({required this.user});
  final AppUser? user;

  @override
  Widget build(BuildContext context) {
    final name = user?.displayName.isNotEmpty == true
        ? user!.displayName
        : 'Pengguna';
    final roleSuffix = user != null ? ' · ${_roleName(user!.role)}' : '';
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.teal700, AppColors.teal600],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Halo, $name 👋',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Selamat datang kembali di E-POS AC$roleSuffix.',
            style: const TextStyle(color: Color(0xFFCFF5EF), fontSize: 14),
          ),
        ],
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.label,
    required this.accent,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
                child: Icon(icon, color: accent, size: 24),
              ),
              Text(
                label,
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 15,
                  color: AppColors.slate900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RealtimeBadge extends StatelessWidget {
  const _RealtimeBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.teal50,
        borderRadius: BorderRadius.circular(999),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _Dot(),
          SizedBox(width: 6),
          Text(
            'Realtime',
            style: TextStyle(
              color: AppColors.teal700,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot();
  @override
  Widget build(BuildContext context) => Container(
        width: 8,
        height: 8,
        decoration: const BoxDecoration(
          color: AppColors.green600,
          shape: BoxShape.circle,
        ),
      );
}
