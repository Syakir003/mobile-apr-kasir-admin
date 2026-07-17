import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../data/models/installation_package.dart';
import '../master_providers.dart';
import '../widgets/master_list_scaffold.dart';

class PackageListScreen extends ConsumerWidget {
  const PackageListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(packageListProvider);
    return MasterListScaffold<InstallationPackage>(
      title: 'Paket Instalasi',
      items: items,
      titleOf: (p) => p.name,
      subtitleOf: (p) => '${p.items.length} item',
      isActive: (p) => p.active,
      matches: (p, q) => p.name.toLowerCase().contains(q.toLowerCase()),
      onAdd: () => context.go('/packages/new'),
      onEdit: (p) => context.go('/packages/${p.id}/edit', extra: p),
    );
  }
}
